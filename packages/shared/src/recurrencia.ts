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

export const ZONA_POR_DEFECTO = "Europe/Madrid";

/** Comprueba que la cadena es una zona IANA que Intl reconoce. */
export function esZonaValida(valor: string): boolean {
  if (valor.length === 0 || valor.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("es", { timeZone: valor });
    return true;
  } catch {
    return false;
  }
}

export const esquemaZona = z.string().trim().refine(esZonaValida, "Zona horaria no válida");

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateadorZona(zona: string): Intl.DateTimeFormat {
  const existente = formateadores.get(zona);
  if (existente) {
    return existente;
  }
  const formateador = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formateadores.set(zona, formateador);
  return formateador;
}

/** Partes de hora de pared de un instante en la zona indicada. */
export function partesEnZona(fecha: Date, zona: string): PartesFecha {
  const partes = formateadorZona(zona).formatToParts(fecha);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value ?? "0");
  return {
    anio: valor("year"),
    mes: valor("month"),
    dia: valor("day"),
    hora: valor("hour"),
    minuto: valor("minute"),
    segundo: valor("second"),
  };
}

function msDeHoraPared(partes: PartesFecha, milisegundos: number): number {
  return Date.UTC(
    partes.anio,
    partes.mes - 1,
    partes.dia,
    partes.hora,
    partes.minuto,
    partes.segundo,
    milisegundos,
  );
}

/** Desfase en minutos de la zona respecto a UTC en ese instante. */
export function desfaseEnMinutos(fecha: Date, zona: string): number {
  const partes = partesEnZona(fecha, zona);
  const instanteSinMs = fecha.getTime() - fecha.getUTCMilliseconds();
  return Math.round((msDeHoraPared(partes, 0) - instanteSinMs) / 60000);
}

/**
 * Devuelve una fecha "flotante" cuyos campos UTC son la hora de pared del
 * instante indicado en la zona.
 */
export function aHoraPared(fecha: Date, zona: string): Date {
  const partes = partesEnZona(fecha, zona);
  return new Date(msDeHoraPared(partes, fecha.getUTCMilliseconds()));
}

/**
 * Convierte una hora de pared (fecha flotante) al instante real en la zona.
 * Las horas inexistentes por el salto de primavera se desplazan hacia delante
 * y las ambiguas de otoño usan la primera ocurrencia.
 */
export function instanteDesdeHoraPared(pared: Date, zona: string): Date {
  const objetivo = pared.getTime();
  const referencias = [objetivo - MILISEGUNDOS_POR_DIA, objetivo, objetivo + MILISEGUNDOS_POR_DIA];
  const desfases = new Set(referencias.map((ms) => desfaseEnMinutos(new Date(ms), zona)));
  const candidatos = [...desfases].map((minutos) => new Date(objetivo - minutos * 60000));
  const exactos = candidatos.filter(
    (candidato) => aHoraPared(candidato, zona).getTime() === objetivo,
  );

  if (exactos.length > 0) {
    return new Date(Math.min(...exactos.map((candidato) => candidato.getTime())));
  }

  const desfaseAnterior = desfaseEnMinutos(new Date(objetivo - MILISEGUNDOS_POR_DIA), zona);
  return new Date(objetivo - desfaseAnterior * 60000);
}

export interface DatosRecurrencia {
  inicio: Date;
  recurrencia: string | null;
  zona?: string | null;
}

const TOPE_OCURRENCIAS = 1000;

/**
 * Expande las ocurrencias de una tarea dentro del rango [desde, hasta].
 * Sin recurrencia solo devuelve el inicio si cae dentro del rango. Con
 * recurrencia respeta la hora de pared de la zona (por defecto UTC) y aplica
 * un tope duro de 1000 resultados.
 */
export function expandirOcurrencias(
  { inicio, recurrencia, zona }: DatosRecurrencia,
  desde: Date,
  hasta: Date,
): Date[] {
  if (!recurrencia) {
    return inicio >= desde && inicio <= hasta ? [inicio] : [];
  }

  if (!esReglaRecurrenciaValida(recurrencia)) {
    return [];
  }

  const zonaValida = zona && zona !== "UTC" && esZonaValida(zona) ? zona : null;
  const opciones = RRule.parseString(`RRULE:${recurrencia}`);

  if (!zonaValida) {
    const regla = new RRule({ ...opciones, dtstart: inicio, tzid: "UTC" });
    const resultado: Date[] = [];
    regla.between(desde, hasta, true, (fecha) => {
      resultado.push(fecha);
      return resultado.length < TOPE_OCURRENCIAS;
    });
    return resultado.slice(0, TOPE_OCURRENCIAS);
  }

  const paredInicio = aHoraPared(inicio, zonaValida);
  const paredDesde = new Date(aHoraPared(desde, zonaValida).getTime() - MILISEGUNDOS_POR_DIA);
  const paredHasta = new Date(aHoraPared(hasta, zonaValida).getTime() + MILISEGUNDOS_POR_DIA);
  const regla = new RRule({ ...opciones, dtstart: paredInicio, tzid: "UTC" });
  const paredes: Date[] = [];

  regla.between(paredDesde, paredHasta, true, (fecha) => {
    paredes.push(fecha);
    return paredes.length < TOPE_OCURRENCIAS;
  });

  const resultado: Date[] = [];
  for (const pared of paredes) {
    const instante = instanteDesdeHoraPared(pared, zonaValida);
    if (instante >= desde && instante <= hasta) {
      resultado.push(instante);
      if (resultado.length >= TOPE_OCURRENCIAS) {
        break;
      }
    }
  }

  return resultado;
}
