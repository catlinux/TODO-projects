import * as rruleModulo from "rrule";
import { z } from "zod";

// En Node (ESM) `rrule` es CommonJS y solo expone `default`; en Vite expone exportaciones con nombre.
const { RRule } = (
  "RRule" in rruleModulo
    ? rruleModulo
    : (rruleModulo as unknown as { default: typeof rruleModulo }).default
) as typeof rruleModulo;

const FRECUENCIAS_VALIDAS = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const DIAS_VALIDOS = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);

function fechaUntilValida(valor: string): boolean {
  const coincidencia = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(valor);
  if (!coincidencia) {
    return false;
  }

  const [, anio, mes, dia, hora, minuto, segundo] = coincidencia;
  const fecha = new Date(
    Date.UTC(
      Number(anio),
      Number(mes) - 1,
      Number(dia),
      Number(hora),
      Number(minuto),
      Number(segundo),
    ),
  );

  return (
    fecha.getUTCFullYear() === Number(anio) &&
    fecha.getUTCMonth() === Number(mes) - 1 &&
    fecha.getUTCDate() === Number(dia) &&
    fecha.getUTCHours() === Number(hora) &&
    fecha.getUTCMinutes() === Number(minuto) &&
    fecha.getUTCSeconds() === Number(segundo)
  );
}

/**
 * Valida una cadena de regla RRULE sin prefijo `RRULE:` ni `DTSTART`.
 * Solo admite FREQ (obligatorio), INTERVAL, BYDAY y COUNT o UNTIL (nunca ambos).
 */
export function esReglaRecurrenciaValida(valor: string): boolean {
  if (valor.length === 0 || valor.startsWith("RRULE:") || valor.includes("DTSTART")) {
    return false;
  }

  const vistas = new Set<string>();
  let frecuencia: string | null = null;
  let intervalo: number | null = null;
  let cuenta: number | null = null;
  let hasta: string | null = null;

  for (const parte of valor.split(";")) {
    const separador = parte.indexOf("=");
    if (separador <= 0) {
      return false;
    }

    const clave = parte.slice(0, separador);
    const contenido = parte.slice(separador + 1);
    if (contenido.length === 0 || vistas.has(clave)) {
      return false;
    }
    vistas.add(clave);

    switch (clave) {
      case "FREQ": {
        if (!FRECUENCIAS_VALIDAS.has(contenido)) {
          return false;
        }
        frecuencia = contenido;
        break;
      }
      case "INTERVAL": {
        if (!/^\d+$/.test(contenido)) {
          return false;
        }
        const numero = Number(contenido);
        if (numero < 1 || numero > 99) {
          return false;
        }
        intervalo = numero;
        break;
      }
      case "BYDAY": {
        const dias = contenido.split(",");
        if (dias.length === 0 || dias.some((dia) => !DIAS_VALIDOS.has(dia))) {
          return false;
        }
        break;
      }
      case "COUNT": {
        if (!/^\d+$/.test(contenido)) {
          return false;
        }
        const numero = Number(contenido);
        if (numero < 1 || numero > 1000) {
          return false;
        }
        cuenta = numero;
        break;
      }
      case "UNTIL": {
        if (!fechaUntilValida(contenido)) {
          return false;
        }
        hasta = contenido;
        break;
      }
      default:
        return false;
    }
  }

  if (!frecuencia) {
    return false;
  }
  if (cuenta !== null && hasta !== null) {
    return false;
  }
  if (intervalo !== null && intervalo < 1) {
    return false;
  }

  return true;
}

export const esquemaRecurrencia = z
  .string()
  .trim()
  .refine(esReglaRecurrenciaValida, "Regla de recurrencia no válida");

export interface DatosRecurrencia {
  inicio: Date;
  recurrencia: string | null;
}

const TOPE_OCURRENCIAS = 1000;

/**
 * Expande las ocurrencias de una tarea dentro del rango [desde, hasta].
 * Sin recurrencia solo devuelve el inicio si cae dentro del rango.
 * Con recurrencia usa DTSTART en UTC y aplica un tope duro de 1000 resultados.
 */
export function expandirOcurrencias(
  { inicio, recurrencia }: DatosRecurrencia,
  desde: Date,
  hasta: Date,
): Date[] {
  if (!recurrencia) {
    return inicio >= desde && inicio <= hasta ? [inicio] : [];
  }

  if (!esReglaRecurrenciaValida(recurrencia)) {
    return [];
  }

  const opciones = RRule.parseString(`RRULE:${recurrencia}`);
  const regla = new RRule({ ...opciones, dtstart: inicio, tzid: "UTC" });
  const resultado: Date[] = [];

  regla.between(desde, hasta, true, (fecha) => {
    resultado.push(fecha);
    return resultado.length < TOPE_OCURRENCIAS;
  });

  return resultado.slice(0, TOPE_OCURRENCIAS);
}
