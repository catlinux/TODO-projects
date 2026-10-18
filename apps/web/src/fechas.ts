const UN_DIA_MS = 24 * 60 * 60 * 1000;

export type EstadoFecha = "atrasada" | "proxima" | "normal";

export interface ChipFecha {
  estado: EstadoFecha;
  texto: string;
}

function inicioDelDia(fecha: Date): number {
  return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()).getTime();
}

function diasDeDiferencia(fecha: Date, referencia: Date): number {
  return Math.round((inicioDelDia(fecha) - inicioDelDia(referencia)) / UN_DIA_MS);
}

function horaCorta(fecha: Date): string {
  return fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function diaCorto(fecha: Date): string {
  return fecha.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(/\.$/, "");
}

/**
 * Datos del chip de fecha de una tarjeta: estado (atrasada si ya venció,
 * próxima si vence en 24 h o menos, normal en el resto) y texto relativo corto
 * en es-ES (Hoy 18:30, Mañana 10:00, Ayer, 24 oct).
 */
export function chipFecha(
  venceEn: string | null | undefined,
  ahora: Date = new Date(),
): ChipFecha | null {
  if (!venceEn) {
    return null;
  }

  const fecha = new Date(venceEn);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }

  const diferencia = fecha.getTime() - ahora.getTime();
  const estado: EstadoFecha =
    diferencia < 0 ? "atrasada" : diferencia <= UN_DIA_MS ? "proxima" : "normal";

  const dias = diasDeDiferencia(fecha, ahora);
  let texto: string;
  if (dias === 0) {
    texto = `Hoy ${horaCorta(fecha)}`;
  } else if (dias === 1) {
    texto = `Mañana ${horaCorta(fecha)}`;
  } else if (dias === -1) {
    texto = "Ayer";
  } else {
    texto = diaCorto(fecha);
  }

  return { estado, texto };
}
