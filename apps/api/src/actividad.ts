import { type FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { actividad, columnas, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { colocarTareaEnColumna, reindexarColumna } from "./tablero-posiciones.js";

const MENSAJE_CAMBIO = "La tarea ha cambiado desde entonces; no se puede deshacer automáticamente";

export interface InstantaneaTarea {
  titulo: string;
  descripcion: string | null;
  proyectoId: string;
  columnaId: string;
  posicion: number;
  venceEn: string | null;
  recurrencia: string | null;
  zona: string;
  recordatorioMin: number | null;
}

export function instantaneaTarea(fila: typeof tareas.$inferSelect): InstantaneaTarea {
  return {
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    proyectoId: fila.proyectoId,
    columnaId: fila.columnaId,
    posicion: fila.posicion,
    venceEn: fila.venceEn ? fila.venceEn.toISOString() : null,
    recurrencia: fila.recurrencia,
    zona: fila.zona,
    recordatorioMin: fila.recordatorioMin,
  };
}

/** Compara dos instantáneas ignorando la posición (que se reindexa aparte). */
export function mismaInstantanea(a: InstantaneaTarea, b: InstantaneaTarea): boolean {
  return (
    a.titulo === b.titulo &&
    a.descripcion === b.descripcion &&
    a.proyectoId === b.proyectoId &&
    a.columnaId === b.columnaId &&
    a.venceEn === b.venceEn &&
    a.recurrencia === b.recurrencia &&
    a.zona === b.zona &&
    a.recordatorioMin === b.recordatorioMin
  );
}

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatosActividad {
  usuarioId: string;
  tokenId: string;
  tokenNombre: string | null;
  accion: "crear" | "editar" | "borrar";
  entidadId: string;
  antes: InstantaneaTarea | null;
  despues: InstantaneaTarea | null;
}

export async function registrarActividad(tx: Tx, datos: DatosActividad): Promise<void> {
  await tx.insert(actividad).values({
    usuarioId: datos.usuarioId,
    tokenId: datos.tokenId,
    tokenNombre: datos.tokenNombre,
    accion: datos.accion,
    entidad: "tarea",
    entidadId: datos.entidadId,
    antes: datos.antes,
    despues: datos.despues,
  });
}

class ErrorDeshacer extends Error {
  constructor(
    readonly estado: number,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorDeshacer";
  }
}

function instantaneaJson(valor: unknown): InstantaneaTarea | null {
  return valor === null || valor === undefined ? null : (valor as InstantaneaTarea);
}

async function comprobarProyectoYColumna(
  tx: Tx,
  proyectoId: string,
  columnaId: string,
): Promise<void> {
  const [proyecto] = await tx
    .select({ id: proyectos.id })
    .from(proyectos)
    .where(eq(proyectos.id, proyectoId))
    .limit(1);
  if (!proyecto) {
    throw new ErrorDeshacer(409, "El proyecto ya no existe");
  }

  const [columna] = await tx
    .select({ id: columnas.id })
    .from(columnas)
    .where(and(eq(columnas.id, columnaId), eq(columnas.proyectoId, proyectoId)))
    .limit(1);
  if (!columna) {
    throw new ErrorDeshacer(409, "La columna ya no existe");
  }
}

export interface ResultadoDeshacer {
  estado: number;
  mensaje?: string;
}

/** Deshace una actividad de tarea (crear, editar o borrar) si no hay cambios posteriores. */
export async function deshacerActividad(
  db: Database,
  usuarioId: string,
  actividadId: string,
): Promise<ResultadoDeshacer> {
  const [registro] = await db
    .select()
    .from(actividad)
    .where(and(eq(actividad.id, actividadId), eq(actividad.usuarioId, usuarioId)))
    .limit(1);

  if (!registro) {
    return { estado: 404, mensaje: "Actividad no encontrada" };
  }
  if (registro.deshechoEn !== null) {
    return { estado: 409, mensaje: "Ya está deshecho" };
  }

  const antes = instantaneaJson(registro.antes);
  const despues = instantaneaJson(registro.despues);

  try {
    await db.transaction(async (tx) => {
      if (registro.accion === "crear") {
        if (!despues) {
          throw new ErrorDeshacer(409, "No se puede deshacer esta acción");
        }
        const [actual] = await tx
          .select()
          .from(tareas)
          .where(eq(tareas.id, registro.entidadId))
          .limit(1);
        if (!actual) {
          throw new ErrorDeshacer(409, "La tarea ya no existe");
        }
        if (!mismaInstantanea(instantaneaTarea(actual), despues)) {
          throw new ErrorDeshacer(409, MENSAJE_CAMBIO);
        }

        await tx.delete(tareas).where(eq(tareas.id, actual.id));
        const restantes = await tx
          .select({ id: tareas.id })
          .from(tareas)
          .where(eq(tareas.columnaId, actual.columnaId))
          .orderBy(asc(tareas.posicion));
        await reindexarColumna(
          tx,
          actual.columnaId,
          restantes.map((fila) => fila.id),
        );
      } else if (registro.accion === "editar") {
        if (!antes || !despues) {
          throw new ErrorDeshacer(409, "No se puede deshacer esta acción");
        }
        const [actual] = await tx
          .select()
          .from(tareas)
          .where(eq(tareas.id, registro.entidadId))
          .limit(1);
        if (!actual) {
          throw new ErrorDeshacer(409, "La tarea ya no existe");
        }
        if (!mismaInstantanea(instantaneaTarea(actual), despues)) {
          throw new ErrorDeshacer(409, MENSAJE_CAMBIO);
        }
        await comprobarProyectoYColumna(tx, antes.proyectoId, antes.columnaId);

        const posicionFinal = await colocarTareaEnColumna(tx, {
          tareaId: actual.id,
          columnaOrigenId: actual.columnaId,
          columnaDestinoId: antes.columnaId,
          posicion: antes.posicion,
        });

        await tx
          .update(tareas)
          .set({
            titulo: antes.titulo,
            descripcion: antes.descripcion,
            columnaId: antes.columnaId,
            posicion: posicionFinal,
            venceEn: antes.venceEn ? new Date(antes.venceEn) : null,
            recurrencia: antes.recurrencia,
            zona: antes.zona,
            recordatorioMin: antes.recordatorioMin,
            updatedAt: new Date(),
          })
          .where(eq(tareas.id, actual.id));
      } else if (registro.accion === "borrar") {
        if (!antes) {
          throw new ErrorDeshacer(409, "No se puede deshacer esta acción");
        }
        await comprobarProyectoYColumna(tx, antes.proyectoId, antes.columnaId);

        const ids = await tx
          .select({ id: tareas.id })
          .from(tareas)
          .where(eq(tareas.columnaId, antes.columnaId))
          .orderBy(asc(tareas.posicion));
        const posicionFinal = Math.min(Math.max(antes.posicion, 0), ids.length);

        await tx.insert(tareas).values({
          id: registro.entidadId,
          proyectoId: antes.proyectoId,
          columnaId: antes.columnaId,
          titulo: antes.titulo,
          descripcion: antes.descripcion,
          posicion: posicionFinal,
          venceEn: antes.venceEn ? new Date(antes.venceEn) : null,
          recurrencia: antes.recurrencia,
          zona: antes.zona,
          recordatorioMin: antes.recordatorioMin,
        });

        const idsFinal = ids.map((fila) => fila.id);
        idsFinal.splice(posicionFinal, 0, registro.entidadId);
        await reindexarColumna(tx, antes.columnaId, idsFinal);
      } else {
        throw new ErrorDeshacer(409, "No se puede deshacer esta acción");
      }

      await tx
        .update(actividad)
        .set({ deshechoEn: new Date() })
        .where(eq(actividad.id, registro.id));
    });
  } catch (error) {
    if (error instanceof ErrorDeshacer) {
      return { estado: error.estado, mensaje: error.message };
    }
    throw error;
  }

  return { estado: 204 };
}

export function registrarRutasActividad(app: FastifyInstance, db: Database): void {
  app.get("/actividad", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const limiteCrudo = Number((request.query as { limite?: string }).limite ?? "50");
    const limite = Number.isFinite(limiteCrudo)
      ? Math.min(Math.max(Math.trunc(limiteCrudo), 1), 200)
      : 50;

    const filas = await db
      .select()
      .from(actividad)
      .where(eq(actividad.usuarioId, usuario.id))
      .orderBy(desc(actividad.createdAt), desc(actividad.id))
      .limit(limite);

    return filas.map((fila) => {
      const antes = instantaneaJson(fila.antes);
      const despues = instantaneaJson(fila.despues);
      return {
        id: fila.id,
        accion: fila.accion,
        entidad: fila.entidad,
        entidadId: fila.entidadId,
        tokenNombre: fila.tokenNombre,
        antes,
        despues,
        deshechoEn: fila.deshechoEn,
        createdAt: fila.createdAt,
        titulo: antes?.titulo ?? despues?.titulo ?? null,
      };
    });
  });

  app.post("/actividad/:id/deshacer", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = z
      .object({ id: z.string().uuid("Identificador no válido") })
      .safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const resultado = await deshacerActividad(db, usuario.id, params.data.id);
    if (resultado.estado === 204) {
      reply.code(204).send();
      return;
    }
    reply.code(resultado.estado).send({ mensaje: resultado.mensaje });
  });
}
