import { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaTarea, esquemaTareaParcial } from "@todo/shared";

import { columnas, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

type TaskChanges = {
  titulo?: string;
  descripcion?: string | null;
  columnaId?: string;
  posicion?: number;
  venceEn?: Date | null;
  updatedAt: Date;
};

async function obtenerTareaPropia(db: Database, id: string, usuarioId: string) {
  const [fila] = await db
    .select({ tarea: tareas, proyecto: proyectos })
    .from(tareas)
    .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
    .where(and(eq(tareas.id, id), eq(proyectos.propietarioId, usuarioId)))
    .limit(1);

  return fila ?? null;
}

async function reindexarColumna(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  columnaId: string,
  idsEnOrden: string[],
) {
  for (let i = 0; i < idsEnOrden.length; i += 1) {
    await tx.update(tareas).set({ posicion: i }).where(eq(tareas.id, idsEnOrden[i]!));
  }
}

export function registrarRutasTareas(app: FastifyInstance, db: Database): void {
  app.get("/proyectos/:id/tareas", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const [proyecto] = await db
      .select({ id: proyectos.id })
      .from(proyectos)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!proyecto) {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    const filas = await db
      .select()
      .from(tareas)
      .leftJoin(columnas, eq(tareas.columnaId, columnas.id))
      .where(eq(tareas.proyectoId, params.data.id))
      .orderBy(asc(columnas.posicion), asc(tareas.posicion));

    return filas.map((fila) => fila.tareas);
  });

  app.post("/proyectos/:id/tareas", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const [proyecto] = await db
      .select({ id: proyectos.id })
      .from(proyectos)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!proyecto) {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    const body = esquemaTarea.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de tarea no válidos" });
      return;
    }

    const [primeraColumna] = await db
      .select()
      .from(columnas)
      .where(eq(columnas.proyectoId, params.data.id))
      .orderBy(asc(columnas.posicion))
      .limit(1);

    if (!primeraColumna) {
      reply.code(500).send({ mensaje: "El proyecto no tiene columnas" });
      return;
    }

    let columnaDestino = primeraColumna;
    if (body.data.columnaId) {
      const [columna] = await db
        .select()
        .from(columnas)
        .where(and(eq(columnas.id, body.data.columnaId), eq(columnas.proyectoId, params.data.id)))
        .limit(1);

      if (!columna) {
        reply.code(400).send({ mensaje: "Columna no válida" });
        return;
      }
      columnaDestino = columna;
    }

    const existentes = await db
      .select({ id: tareas.id })
      .from(tareas)
      .where(eq(tareas.columnaId, columnaDestino.id));

    const posicion = existentes.length;

    const [tarea] = await db
      .insert(tareas)
      .values({
        proyectoId: params.data.id,
        columnaId: columnaDestino.id,
        titulo: body.data.titulo,
        descripcion: body.data.descripcion,
        posicion,
        venceEn: body.data.venceEn,
      })
      .returning();

    if (!tarea) {
      reply.code(500).send({ mensaje: "No se pudo crear la tarea" });
      return;
    }

    reply.code(201).send(tarea);
  });

  app.get("/tareas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    return fila.tarea;
  });

  app.patch("/tareas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const body = esquemaTareaParcial.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de tarea no válidos" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const tareaActual = fila.tarea;
    const proyectoId = tareaActual.proyectoId;

    const targetColumnIdRequested = body.data.columnaId;
    let columnaDestinoId = tareaActual.columnaId;

    if (targetColumnIdRequested !== undefined) {
      const [columna] = await db
        .select()
        .from(columnas)
        .where(and(eq(columnas.id, targetColumnIdRequested), eq(columnas.proyectoId, proyectoId)))
        .limit(1);

      if (!columna) {
        reply.code(400).send({ mensaje: "Columna no válida" });
        return;
      }
      columnaDestinoId = columna.id;
    }

    const moving = targetColumnIdRequested !== undefined || body.data.posicion !== undefined;

    const cambios: TaskChanges = { updatedAt: new Date() };
    if (body.data.titulo !== undefined) cambios.titulo = body.data.titulo;
    if (body.data.descripcion !== undefined) cambios.descripcion = body.data.descripcion;
    if (body.data.venceEn !== undefined) cambios.venceEn = body.data.venceEn;
    if (moving) cambios.columnaId = columnaDestinoId;

    if (moving) {
      await db.transaction(async (tx) => {
        const cross = tareaActual.columnaId !== columnaDestinoId;

        if (cross) {
          const idsOrigen = (
            await tx
              .select({ id: tareas.id })
              .from(tareas)
              .where(eq(tareas.columnaId, tareaActual.columnaId))
              .orderBy(asc(tareas.posicion))
          )
            .map((r) => r.id)
            .filter((id) => id !== params.data.id);

          const idsDestino = (
            await tx
              .select({ id: tareas.id })
              .from(tareas)
              .where(eq(tareas.columnaId, columnaDestinoId))
              .orderBy(asc(tareas.posicion))
          )
            .map((r) => r.id)
            .filter((id) => id !== params.data.id);

          const requested = body.data.posicion ?? idsDestino.length;
          const posicionFinal = Math.min(Math.max(requested, 0), idsDestino.length);

          await reindexarColumna(tx, tareaActual.columnaId, idsOrigen);
          idsDestino.splice(posicionFinal, 0, params.data.id);
          await reindexarColumna(tx, columnaDestinoId, idsDestino);

          cambios.posicion = posicionFinal;
        } else {
          const idsColumna = (
            await tx
              .select({ id: tareas.id })
              .from(tareas)
              .where(eq(tareas.columnaId, tareaActual.columnaId))
              .orderBy(asc(tareas.posicion))
          ).map((r) => r.id);

          const idsSinActual = idsColumna.filter((id) => id !== params.data.id);
          const requested =
            body.data.posicion !== undefined
              ? body.data.posicion
              : idsColumna.indexOf(params.data.id);
          const posicionFinal = Math.min(Math.max(requested, 0), idsSinActual.length);

          const reordered = [...idsSinActual];
          reordered.splice(posicionFinal, 0, params.data.id);
          await reindexarColumna(tx, tareaActual.columnaId, reordered);

          cambios.posicion = posicionFinal;
        }

        await tx.update(tareas).set(cambios).where(eq(tareas.id, params.data.id));
      });
    } else {
      await db.update(tareas).set(cambios).where(eq(tareas.id, params.data.id));
    }

    const [tarea] = await db.select().from(tareas).where(eq(tareas.id, params.data.id)).limit(1);

    if (!tarea) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    reply.send(tarea);
  });

  app.delete("/tareas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const columnaId = fila.tarea.columnaId;
    await db.delete(tareas).where(eq(tareas.id, params.data.id));

    const restantes = await db
      .select({ id: tareas.id })
      .from(tareas)
      .where(eq(tareas.columnaId, columnaId))
      .orderBy(asc(tareas.posicion));

    await db.transaction(async (tx) => {
      await reindexarColumna(
        tx,
        columnaId,
        restantes.map((r) => r.id),
      );
    });

    reply.code(204).send();
  });
}
