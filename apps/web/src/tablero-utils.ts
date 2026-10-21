/** Clave de localStorage donde el proyecto recuerda sus columnas compactas. */
function claveColumnasCompactas(proyectoId: string): string {
  return `todo.compactas.${proyectoId}`;
}

/** Columnas que el usuario dejó en vista compacta; ausente o ilegible → ninguna. */
export function leerColumnasCompactas(proyectoId: string): string[] {
  try {
    const crudo = window.localStorage.getItem(claveColumnasCompactas(proyectoId));
    if (!crudo) return [];
    const datos: unknown = JSON.parse(crudo);
    if (!Array.isArray(datos)) return [];
    return datos.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function guardarColumnasCompactas(proyectoId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(claveColumnasCompactas(proyectoId), JSON.stringify(ids));
  } catch {
    // Sin localStorage (modo privado): la elección dura lo que la página.
  }
}

/**
 * Anulaciones individuales de tarjeta: `true` la contrae y `false` la expande,
 * por encima del estado de su columna. Solo aparecen las tarjetas anuladas.
 */
export type AnulacionesTarjeta = Record<string, boolean>;

/** Clave de localStorage donde el proyecto recuerda las tarjetas anuladas. */
function claveTarjetasAnuladas(proyectoId: string): string {
  return `todo.tarjetas.${proyectoId}`;
}

/** Anulaciones guardadas del proyecto; ausente o ilegible → ninguna. */
export function leerAnulacionesTarjeta(proyectoId: string): AnulacionesTarjeta {
  try {
    const crudo = window.localStorage.getItem(claveTarjetasAnuladas(proyectoId));
    if (!crudo) return {};
    const datos: unknown = JSON.parse(crudo);
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return {};
    const salida: AnulacionesTarjeta = {};
    for (const [tareaId, valor] of Object.entries(datos)) {
      if (typeof valor === "boolean") salida[tareaId] = valor;
    }
    return salida;
  } catch {
    return {};
  }
}

export function guardarAnulacionesTarjeta(
  proyectoId: string,
  anulaciones: AnulacionesTarjeta,
): void {
  try {
    window.localStorage.setItem(claveTarjetasAnuladas(proyectoId), JSON.stringify(anulaciones));
  } catch {
    // Sin localStorage (modo privado): la elección dura lo que la página.
  }
}

/** Estado compacto efectivo: la anulación individual manda sobre la columna. */
export function estaTarjetaContraida(
  tareaId: string,
  columnaContraida: boolean,
  anulaciones: AnulacionesTarjeta,
): boolean {
  return anulaciones[tareaId] ?? columnaContraida;
}

/**
 * Invierte el estado compacto de una tarjeta. Si el resultado coincide con el de
 * su columna, la anulación sobra y se borra para no acumular ids.
 */
export function alternarAnulacionTarjeta(
  anulaciones: AnulacionesTarjeta,
  tareaId: string,
  columnaContraida: boolean,
): AnulacionesTarjeta {
  const contraida = !estaTarjetaContraida(tareaId, columnaContraida, anulaciones);
  if (contraida === columnaContraida) {
    return borrarAnulacionesTarjeta(anulaciones, [tareaId]);
  }
  return { ...anulaciones, [tareaId]: contraida };
}

/** Quita las anulaciones de las tareas indicadas sin tocar las demás. */
export function borrarAnulacionesTarjeta(
  anulaciones: AnulacionesTarjeta,
  tareasIds: readonly string[],
): AnulacionesTarjeta {
  const aBorrar = new Set(tareasIds);
  const claves = Object.keys(anulaciones);
  if (!claves.some((tareaId) => aBorrar.has(tareaId))) return anulaciones;
  const salida: AnulacionesTarjeta = {};
  for (const tareaId of claves) {
    if (!aBorrar.has(tareaId)) salida[tareaId] = anulaciones[tareaId]!;
  }
  return salida;
}

/**
 * Descarta las anulaciones de tareas que ya no existen (borradas o de otro
 * proyecto). Devuelve el mismo objeto si no hay nada que limpiar.
 */
export function limpiarAnulacionesTarjeta(
  anulaciones: AnulacionesTarjeta,
  tareasIds: readonly string[],
): AnulacionesTarjeta {
  const existentes = new Set(tareasIds);
  const claves = Object.keys(anulaciones);
  if (claves.every((tareaId) => existentes.has(tareaId))) return anulaciones;
  const salida: AnulacionesTarjeta = {};
  for (const tareaId of claves) {
    if (existentes.has(tareaId)) salida[tareaId] = anulaciones[tareaId]!;
  }
  return salida;
}

export interface TareaTablero {
  id: string;
  proyectoId: string;
  columnaId: string;
  titulo: string;
  descripcion?: string | null;
  posicion: number;
  venceEn?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Devuelve una nueva lista con la tarea movida a la columna indicada y una
 * posición consecutiva dentro de ella. Si el índice deseado está fuera de rango,
 * se ajusta al primer o último puesto válido.
 */
export function moverTareaEnLista<T extends TareaTablero>(
  tareas: readonly T[],
  tareaId: string,
  columnaDestinoId: string,
  indiceDestino: number,
): T[] {
  const tarea = tareas.find((item) => item.id === tareaId);
  if (!tarea) {
    return tareas.map((item) => ({ ...item }));
  }

  const resto = tareas.filter((item) => item.id !== tareaId);
  const tareasDestino = resto
    .filter((item) => item.columnaId === columnaDestinoId)
    .slice()
    .sort((a, b) => a.posicion - b.posicion);

  const indiceSeguro = Math.max(0, Math.min(indiceDestino, tareasDestino.length));
  const destinoFinal: T[] = [...tareasDestino];
  destinoFinal.splice(indiceSeguro, 0, {
    ...tarea,
    columnaId: columnaDestinoId,
  });

  const porColumna = new Map<string, T[]>();
  for (const item of resto) {
    const actual = porColumna.get(item.columnaId) ?? [];
    actual.push(item);
    porColumna.set(item.columnaId, actual);
  }
  porColumna.set(columnaDestinoId, destinoFinal);

  const salida: T[] = [];
  for (const [columnaId, items] of porColumna) {
    items.forEach((item, indice) => {
      salida.push({
        ...item,
        columnaId,
        posicion: indice,
      });
    });
  }

  return salida;
}
