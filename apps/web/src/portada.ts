import type { CSSProperties } from "react";

import type { PortadaTareaApi } from "./api";

/** Mismas 10 portadas fijas que `PORTADAS_TAREA` de @todo/shared. */
export const COLORES_PORTADA = [
  "#6E4FE6",
  "#C8303A",
  "#2563D9",
  "#18794E",
  "#B4530A",
  "#0E7490",
] as const;

export const PATRONES_PORTADA = [
  "rayas-ambar",
  "cuadros-azul",
  "puntos-rosa",
  "ondas-verde",
] as const;

export type PatronPortada = (typeof PATRONES_PORTADA)[number];

/** Patrones con degradados repetidos: no necesitan imágenes. */
const PATRONES: Record<PatronPortada, CSSProperties> = {
  "rayas-ambar": {
    backgroundImage: "repeating-linear-gradient(45deg, #b4530a 0 8px, #f6c177 8px 16px)",
  },
  "cuadros-azul": {
    backgroundImage:
      "repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.35) 0 6px, transparent 6px 16px), " +
      "repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.35) 0 6px, transparent 6px 16px), " +
      "linear-gradient(#2563d9, #2563d9)",
  },
  "puntos-rosa": {
    backgroundImage: "radial-gradient(#ec4899 2px, transparent 2px)",
    backgroundColor: "#fce7f3",
    backgroundSize: "12px 12px",
  },
  "ondas-verde": {
    backgroundImage: "repeating-radial-gradient(circle at 50% 120%, #18794e 0 8px, #7fd1b0 8px 16px)",
  },
};

/**
 * Estilo de la portada de una tarea. La portada de imagen se ignora hasta la
 * fase E; devuelve `null` cuando no hay nada que pintar.
 */
export function estiloPortada(
  portada: PortadaTareaApi | null | undefined,
): CSSProperties | null {
  if (!portada || portada.tipo !== "color") return null;
  if (portada.valor.startsWith("#")) return { backgroundColor: portada.valor };
  const patron = PATRONES[portada.valor as PatronPortada];
  return patron ?? null;
}
