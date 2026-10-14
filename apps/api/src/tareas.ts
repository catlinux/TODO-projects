import { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaTarea, esquemaTareaParcial } from "@todo/shared";

import { proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

type CamposTareaActualizados = {
  titulo?: string;
  descripcion?: string;
  estado?: "pendiente" | "en_curso" | "hecha";
  venceEn?: Date | null;
  updatedAt: Date;
};

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

    return db
      .select()
      .from(tareas)
      .where(eq(tareas.proyectoId, params.data.id))
      .orderBy(asc(tareas.createdAt));
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

    const [tarea] = await db
      .insert(tareas)
      .values({
        proyectoId: params.data.id,
        titulo: body.data.titulo,
        descripcion: body.data.descripcion,
        estado: body.data.estado,
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

    const [fila] = await db
      .select({ tarea: tareas })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .where(and(eq(tareas.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

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

    const [existente] = await db
      .select({ id: tareas.id })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .where(and(eq(tareas.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!existente) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const cambios: CamposTareaActualizados = { updatedAt: new Date() };
    if (body.data.titulo !== undefined) cambios.titulo = body.data.titulo;
    if (body.data.descripcion !== undefined) cambios.descripcion = body.data.descripcion;
    if (body.data.estado !== undefined) cambios.estado = body.data.estado;
    if (body.data.venceEn !== undefined) cambios.venceEn = body.data.venceEn;

    const [tarea] = await db
      .update(tareas)
      .set(cambios)
      .where(eq(tareas.id, params.data.id))
      .returning();

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

    const [existente] = await db
      .select({ id: tareas.id })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .where(and(eq(tareas.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!existente) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    await db.delete(tareas).where(eq(tareas.id, params.data.id));
    reply.code(204).send();
  });
}
