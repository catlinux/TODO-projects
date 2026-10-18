// Paleta cíclica del plan, asignada por orden de creación del proyecto.
export const COLORES_PROYECTO = [
  "#2f4bc4",
  "#2f8f62",
  "#c2611b",
  "#7a56c2",
  "#1f7a8c",
  "#b23a6b",
] as const;

export type ColorProyecto = (typeof COLORES_PROYECTO)[number];

export function colorProyecto(indice: number): ColorProyecto {
  return COLORES_PROYECTO[indice % COLORES_PROYECTO.length] ?? COLORES_PROYECTO[0];
}
