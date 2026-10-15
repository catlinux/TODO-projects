import { asc, eq } from "drizzle-orm";

import { tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function reindexarColumna(
  tx: Tx,
  columnaId: string,
  idsEnOrden: string[],
): Promise<void> {
  for (let i = 0; i < idsEnOrden.length; i += 1) {
    await tx.update(tareas).set({ posicion: i }).where(eq(tareas.id, idsEnOrden[i]!));
  }
}

async function idsDeColumna(tx: Tx, columnaId: string): Promise<string[]> {
  const filas = await tx
    .select({ id: tareas.id })
    .from(tareas)
    .where(eq(tareas.columnaId, columnaId))
    .orderBy(asc(tareas.posicion));
  return filas.map((fila) => fila.id);
}

/**
 * Coloca una tarea en una columna y posición, reindexando origen y destino.
 * Devuelve la posición final. Es el algoritmo compartido por el PATCH real y
 * por el deshacer, para no duplicarlo.
 */
export async function colocarTareaEnColumna(
  tx: Tx,
  datos: {
    tareaId: string;
    columnaOrigenId: string;
    columnaDestinoId: string;
    posicion?: number | undefined;
  },
): Promise<number> {
  if (datos.columnaOrigenId === datos.columnaDestinoId) {
    const idsColumna = await idsDeColumna(tx, datos.columnaOrigenId);
    const idsSinActual = idsColumna.filter((id) => id !== datos.tareaId);
    const requested =
      datos.posicion !== undefined ? datos.posicion : idsColumna.indexOf(datos.tareaId);
    const posicionFinal = Math.min(Math.max(requested, 0), idsSinActual.length);

    const reordered = [...idsSinActual];
    reordered.splice(posicionFinal, 0, datos.tareaId);
    await reindexarColumna(tx, datos.columnaOrigenId, reordered);
    return posicionFinal;
  }

  const idsOrigen = (await idsDeColumna(tx, datos.columnaOrigenId)).filter(
    (id) => id !== datos.tareaId,
  );
  const idsDestino = (await idsDeColumna(tx, datos.columnaDestinoId)).filter(
    (id) => id !== datos.tareaId,
  );
  const requested = datos.posicion ?? idsDestino.length;
  const posicionFinal = Math.min(Math.max(requested, 0), idsDestino.length);

  await reindexarColumna(tx, datos.columnaOrigenId, idsOrigen);
  idsDestino.splice(posicionFinal, 0, datos.tareaId);
  await reindexarColumna(tx, datos.columnaDestinoId, idsDestino);
  return posicionFinal;
}
