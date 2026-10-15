import { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaTarea, esquemaTareaParcial, ZONA_POR_DEFECTO } from "@todo/shared";

import { columnas, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { instantaneaTarea, registrarActividad } from "./actividad.js";
import { colocarTareaEnColumna, reindexarColumna } from "./tablero-posiciones.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

type TaskChanges = {
  titulo?: string;
  descripcion?: string | null;
  columnaId?: string;
  posicion?: number;
  venceEn?: Date | null;
  recurrencia?: string | null;
  zona?: string;
  recordatorioMin?: number | null;
  updatedAt: Date;
};

export async function obtenerTareaPropia(db: Database, id: string, usuarioId: string) {
  const [fila] = await db
    .select({ tarea: tareas, proyecto: proyectos })
    .from(tareas)
    .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
    .where(and(eq(tareas.id, id), eq(proyectos.propietarioId, usuarioId)))
    .limit(1);

  return fila ?? null;
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

    const tarea = await db.transaction(async (tx) => {
      const existentes = await tx
        .select({ id: tareas.id })
        .from(tareas)
        .where(eq(tareas.columnaId, columnaDestino.id));

      const posicion = existentes.length;

      const [creada] = await tx
        .insert(tareas)
        .values({
          proyectoId: params.data.id,
          columnaId: columnaDestino.id,
          titulo: body.data.titulo,
          descripcion: body.data.descripcion,
          posicion,
          venceEn: body.data.venceEn,
          recurrencia: body.data.recurrencia ?? null,
          zona: body.data.zona ?? ZONA_POR_DEFECTO,
          recordatorioMin: body.data.recordatorioMin ?? null,
        })
        .returning();

      if (creada && request.tokenId) {
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "crear",
          entidadId: creada.id,
          antes: null,
          despues: instantaneaTarea(creada),
        });
      }

      return creada;
    });

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

    // `venceEn: null` borra también la recurrencia; si hay recurrencia debe
    // quedar una fecha en el valor resultante tras aplicar el parche.
    const venceEnResultante =
      body.data.venceEn !== undefined ? body.data.venceEn : tareaActual.venceEn;
    let recurrenciaResultante =
      body.data.recurrencia !== undefined ? body.data.recurrencia : tareaActual.recurrencia;

    if (body.data.venceEn === null) {
      recurrenciaResultante = null;
    }

    if (recurrenciaResultante != null && venceEnResultante == null) {
      reply.code(400).send({ mensaje: "Una tarea recurrente necesita fecha" });
      return;
    }

    const cambios: TaskChanges = { updatedAt: new Date() };
    if (body.data.titulo !== undefined) cambios.titulo = body.data.titulo;
    if (body.data.descripcion !== undefined) cambios.descripcion = body.data.descripcion;
    if (body.data.venceEn !== undefined) cambios.venceEn = body.data.venceEn;
    if (body.data.recurrencia !== undefined || body.data.venceEn === null) {
      cambios.recurrencia = recurrenciaResultante;
    }
    if (body.data.zona !== undefined) cambios.zona = body.data.zona;
    if (body.data.recordatorioMin !== undefined)
      cambios.recordatorioMin = body.data.recordatorioMin;
    if (moving) cambios.columnaId = columnaDestinoId;

    await db.transaction(async (tx) => {
      if (moving) {
        cambios.posicion = await colocarTareaEnColumna(tx, {
          tareaId: params.data.id,
          columnaOrigenId: tareaActual.columnaId,
          columnaDestinoId,
          posicion: body.data.posicion,
        });
      }

      const despues = instantaneaTarea({
        ...tareaActual,
        titulo: cambios.titulo ?? tareaActual.titulo,
        descripcion:
          cambios.descripcion !== undefined ? cambios.descripcion : tareaActual.descripcion,
        columnaId: cambios.columnaId ?? tareaActual.columnaId,
        posicion: cambios.posicion ?? tareaActual.posicion,
        venceEn: cambios.venceEn !== undefined ? cambios.venceEn : tareaActual.venceEn,
        recurrencia:
          cambios.recurrencia !== undefined ? cambios.recurrencia : tareaActual.recurrencia,
        zona: cambios.zona ?? tareaActual.zona,
        recordatorioMin:
          cambios.recordatorioMin !== undefined
            ? cambios.recordatorioMin
            : tareaActual.recordatorioMin,
        updatedAt: cambios.updatedAt,
      });

      await tx.update(tareas).set(cambios).where(eq(tareas.id, params.data.id));

      if (
        request.tokenId &&
        JSON.stringify(instantaneaTarea(tareaActual)) !== JSON.stringify(despues)
      ) {
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "editar",
          entidadId: params.data.id,
          antes: instantaneaTarea(tareaActual),
          despues,
        });
      }
    });

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

    await db.transaction(async (tx) => {
      await tx.delete(tareas).where(eq(tareas.id, params.data.id));

      const restantes = await tx
        .select({ id: tareas.id })
        .from(tareas)
        .where(eq(tareas.columnaId, columnaId))
        .orderBy(asc(tareas.posicion));

      await reindexarColumna(
        tx,
        columnaId,
        restantes.map((r) => r.id),
      );

      if (request.tokenId) {
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "borrar",
          entidadId: params.data.id,
          antes: instantaneaTarea(fila.tarea),
          despues: null,
        });
      }
    });

    reply.code(204).send();
  });
}
