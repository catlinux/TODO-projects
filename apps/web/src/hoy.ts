import type { OcurrenciaAgenda } from "./api";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/** Días hacia atrás que se muestran como atrasadas. */
export const DIAS_ATRASADAS = 30;
/** Días hacia delante que se muestran como próximos. */
export const DIAS_PROXIMOS = 7;

function inicioDelDia(fecha: Date): Date {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

export interface RangoHoy {
  desde: string;
  hasta: string;
}

/**
 * Rango de `GET /agenda` que cubre las tres secciones de «Hoy»: los últimos
 * 30 días, hoy y los próximos 7. Se calcula desde el inicio del día para que la
 * clave de la consulta sea la misma durante toda la jornada.
 */
export function rangoHoy(ahora: Date = new Date()): RangoHoy {
  const inicio = inicioDelDia(ahora).getTime();
  return {
    desde: new Date(inicio - DIAS_ATRASADAS * MILISEGUNDOS_POR_DIA).toISOString(),
    hasta: new Date(inicio + (DIAS_PROXIMOS + 1) * MILISEGUNDOS_POR_DIA).toISOString(),
  };
}

export interface SeccionesHoy {
  /** No hechas anteriores a hoy, de los últimos 30 días. */
  atrasadas: OcurrenciaAgenda[];
  /** Todas las de hoy, hechas incluidas. */
  hoy: OcurrenciaAgenda[];
  /** No hechas de mañana a los próximos 7 días. */
  proximos: OcurrenciaAgenda[];
}

function porFecha(a: OcurrenciaAgenda, b: OcurrenciaAgenda): number {
  const comparacion = a.fecha.localeCompare(b.fecha);
  return comparacion !== 0 ? comparacion : a.tareaId.localeCompare(b.tareaId);
}

/** Reparte las ocurrencias de la agenda en las tres secciones de «Hoy». */
export function agruparHoy(
  ocurrencias: readonly OcurrenciaAgenda[],
  ahora: Date = new Date(),
): SeccionesHoy {
  const inicioHoy = inicioDelDia(ahora).getTime();
  const finHoy = inicioHoy + MILISEGUNDOS_POR_DIA;
  const limiteAtrasadas = inicioHoy - DIAS_ATRASADAS * MILISEGUNDOS_POR_DIA;
  const limiteProximos = finHoy + DIAS_PROXIMOS * MILISEGUNDOS_POR_DIA;

  const atrasadas: OcurrenciaAgenda[] = [];
  const hoy: OcurrenciaAgenda[] = [];
  const proximos: OcurrenciaAgenda[] = [];

  for (const ocurrencia of ocurrencias) {
    const momento = new Date(ocurrencia.fecha).getTime();
    if (Number.isNaN(momento)) {
      continue;
    }

    if (momento >= inicioHoy && momento < finHoy) {
      hoy.push(ocurrencia);
    } else if (!ocurrencia.hecha) {
      if (momento < inicioHoy) {
        if (momento >= limiteAtrasadas) {
          atrasadas.push(ocurrencia);
        }
      } else if (momento < limiteProximos) {
        proximos.push(ocurrencia);
      }
    }
  }

  atrasadas.sort(porFecha);
  hoy.sort(porFecha);
  proximos.sort(porFecha);

  return { atrasadas, hoy, proximos };
}

/** Atrasadas más las de hoy sin hacer, para el contador del menú. */
export function pendientesHoy(secciones: SeccionesHoy): number {
  return secciones.atrasadas.length + secciones.hoy.filter((ocurrencia) => !ocurrencia.hecha).length;
}

/** Fecha de la cabecera en mayúsculas, p. ej. «DOMINGO 18 OCT». */
export function fechaCabecera(ahora: Date = new Date()): string {
  return ahora
    .toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" })
    .replace(/,\s*/g, " ")
    .replace(/\.$/, "")
    .toUpperCase();
}
