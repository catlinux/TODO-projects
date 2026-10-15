export type FrecuenciaRecurrencia = "ninguna" | "diaria" | "semanal" | "mensual" | "anual";

export interface FinRecurrencia {
  tipo: "nunca" | "veces";
  veces?: number;
}

export interface DatosRecurrencia {
  frecuencia: FrecuenciaRecurrencia;
  intervalo: number;
  dias: string[];
  fin: FinRecurrencia;
}

export const DIAS_SEMANA = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

const FRECUENCIAS_A_RRULE: Record<Exclude<FrecuenciaRecurrencia, "ninguna">, string> = {
  diaria: "DAILY",
  semanal: "WEEKLY",
  mensual: "MONTHLY",
  anual: "YEARLY",
};

const FRECUENCIAS_DESDE_RRULE: Record<string, FrecuenciaRecurrencia> = {
  DAILY: "diaria",
  WEEKLY: "semanal",
  MONTHLY: "mensual",
  YEARLY: "anual",
};

export function recurrenciaPorDefecto(): DatosRecurrencia {
  return { frecuencia: "ninguna", intervalo: 1, dias: [], fin: { tipo: "nunca" } };
}

/** Construye la regla RRULE sin prefijo a partir de los campos del formulario. */
export function construirRegla(datos: DatosRecurrencia): string | null {
  if (datos.frecuencia === "ninguna") {
    return null;
  }

  const partes = [`FREQ=${FRECUENCIAS_A_RRULE[datos.frecuencia]}`];

  const intervalo = Math.min(99, Math.max(1, Math.trunc(datos.intervalo)));
  if (intervalo > 1) {
    partes.push(`INTERVAL=${intervalo}`);
  }

  if (datos.frecuencia === "semanal" && datos.dias.length > 0) {
    const dias = DIAS_SEMANA.filter((dia) => datos.dias.includes(dia));
    if (dias.length > 0) {
      partes.push(`BYDAY=${dias.join(",")}`);
    }
  }

  if (datos.fin.tipo === "veces" && datos.fin.veces !== undefined) {
    const veces = Math.min(1000, Math.max(1, Math.trunc(datos.fin.veces)));
    partes.push(`COUNT=${veces}`);
  }

  return partes.join(";");
}

/**
 * Analiza una regla RRULE sin prefijo. Las partes no soportadas (como UNTIL) se
 * ignoran y dejan el fin como "nunca", conservando el resto de datos.
 */
export function analizarRegla(regla: string | null | undefined): DatosRecurrencia {
  const datos = recurrenciaPorDefecto();
  if (!regla) {
    return datos;
  }

  let tieneUntil = false;
  let cuenta: number | undefined;

  for (const parte of regla.split(";")) {
    const separador = parte.indexOf("=");
    if (separador <= 0) {
      continue;
    }

    const clave = parte.slice(0, separador);
    const valor = parte.slice(separador + 1);

    switch (clave) {
      case "FREQ": {
        datos.frecuencia = FRECUENCIAS_DESDE_RRULE[valor] ?? "ninguna";
        break;
      }
      case "INTERVAL": {
        const numero = Number(valor);
        if (Number.isInteger(numero) && numero >= 1 && numero <= 99) {
          datos.intervalo = numero;
        }
        break;
      }
      case "BYDAY": {
        datos.dias = valor
          .split(",")
          .filter((dia) => (DIAS_SEMANA as readonly string[]).includes(dia));
        break;
      }
      case "COUNT": {
        const numero = Number(valor);
        if (Number.isInteger(numero) && numero >= 1 && numero <= 1000) {
          cuenta = numero;
        }
        break;
      }
      case "UNTIL": {
        tieneUntil = true;
        break;
      }
      default:
        break;
    }
  }

  if (tieneUntil) {
    datos.fin = { tipo: "nunca" };
  } else if (cuenta !== undefined) {
    datos.fin = { tipo: "veces", veces: cuenta };
  }

  return datos;
}

/** Convierte un valor de <input type="datetime-local"> a ISO UTC o null. */
export function aIsoUtc(valorLocal: string | null | undefined): string | null {
  if (!valorLocal) {
    return null;
  }
  const fecha = new Date(valorLocal);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return fecha.toISOString();
}

/** Convierte un ISO UTC a un valor válido de <input type="datetime-local">. */
export function aValorLocal(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return "";
  }
  const dosDigitos = (valor: number) => String(valor).padStart(2, "0");
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}T${dosDigitos(fecha.getHours())}:${dosDigitos(fecha.getMinutes())}`;
}

/** Formatea un ISO en la zona local del navegador, en formato es-ES. */
export function formatearFechaHoraEs(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) {
    return "";
  }
  return fecha.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}
