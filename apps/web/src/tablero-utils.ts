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
