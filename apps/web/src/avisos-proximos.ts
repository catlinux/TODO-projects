import type { OcurrenciaAgenda } from "./api";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/** Días que cubre el panel «Próximos avisos». */
export const DIAS_AVISOS = 7;

export interface AvisoProximo {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  /** Vencimiento de la ocurrencia (ISO). */
  fecha: string;
  /** Hora a la que toca avisar, fecha − recordatorioMin (ISO). */
  horaAviso: string;
  /** Minutos de antelación con los que avisa la tarea. */
  recordatorioMin: number;
  /** Hora del aviso en corto, p. ej. «HOY 18:00» o «LUN 19 · 08:45». */
  horaAvisoTexto: string;
}

function mismoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function horaCorta(fecha: Date): string {
  return fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

/** Hora del aviso en corto: «HOY 18:00» si es hoy y «LUN 19 · 08:45» en el resto. */
export function textoHoraAviso(horaAviso: Date, ahora: Date): string {
  const hora = horaCorta(horaAviso);
  if (mismoDia(horaAviso, ahora)) {
    return `HOY ${hora}`;
  }
  const dia = horaAviso
    .toLocaleDateString("es-ES", { weekday: "short" })
    .replace(/\.$/, "")
    .toUpperCase();
  return `${dia} ${horaAviso.getDate()} · ${hora}`;
}

/**
 * Ocurrencias sin hacer con recordatorio cuyo aviso cae entre `ahora` y los
 * siguientes `dias` días, ordenadas por hora de aviso.
 */
export function avisosProximos(
  ocurrencias: readonly OcurrenciaAgenda[],
  ahora: Date = new Date(),
  dias: number = DIAS_AVISOS,
): AvisoProximo[] {
  const desde = ahora.getTime();
  const hasta = desde + dias * MILISEGUNDOS_POR_DIA;
  const avisos: AvisoProximo[] = [];

  for (const ocurrencia of ocurrencias) {
    if (ocurrencia.hecha || typeof ocurrencia.recordatorioMin !== "number") {
      continue;
    }

    const vencimiento = new Date(ocurrencia.fecha).getTime();
    if (Number.isNaN(vencimiento)) {
      continue;
    }

    const horaAvisoMs = vencimiento - ocurrencia.recordatorioMin * 60 * 1000;
    if (horaAvisoMs < desde || horaAvisoMs > hasta) {
      continue;
    }

    const horaAviso = new Date(horaAvisoMs);
    avisos.push({
      tareaId: ocurrencia.tareaId,
      titulo: ocurrencia.titulo,
      proyectoId: ocurrencia.proyectoId,
      proyectoNombre: ocurrencia.proyectoNombre,
      fecha: ocurrencia.fecha,
      horaAviso: horaAviso.toISOString(),
      recordatorioMin: ocurrencia.recordatorioMin,
      horaAvisoTexto: textoHoraAviso(horaAviso, ahora),
    });
  }

  avisos.sort(
    (a, b) => a.horaAviso.localeCompare(b.horaAviso) || a.tareaId.localeCompare(b.tareaId),
  );

  return avisos;
}
