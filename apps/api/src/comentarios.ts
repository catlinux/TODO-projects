import { type FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaComentario, esquemaComentarioParcial } from "@todo/shared";

import { comentarios, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { obtenerTareaPropia } from "./tareas.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

async function obtenerComentarioPropio(db: Database, id: string, usuarioId: string) {
  const [fila] = await db
    .select({ comentario: comentarios, tareaId: tareas.id })
    .from(comentarios)
    .innerJoin(tareas, eq(comentarios.tareaId, tareas.id))
    .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
    .where(and(eq(comentarios.id, id), eq(proyectos.propietarioId, usuarioId)))
    .limit(1);

  return fila ?? null;
}

export function registrarRutasComentarios(app: FastifyInstance, db: Database): void {
  app.post("/tareas/:id/comentarios", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaComentario.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos del comentario no válidos" });
      return;
    }

    const [comentario] = await db
      .insert(comentarios)
      .values({
        tareaId: params.data.id,
        usuarioId: usuario.id,
        texto: body.data.texto,
      })
      .returning();

    if (!comentario) {
      reply.code(500).send({ mensaje: "No se pudo crear el comentario" });
      return;
    }

    reply.code(201).send({ ...comentario, usuarioNombre: usuario.nombre });
  });

  app.patch("/comentarios/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaComentarioParcial.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos del comentario no válidos" });
      return;
    }

    const fila = await obtenerComentarioPropio(db, params.data.id, usuario.id);
    // Solo el autor edita; otro usuario (o ajeno) recibe 404 igual que si no existiera.
    if (!fila || fila.comentario.usuarioId !== usuario.id) {
      reply.code(404).send({ mensaje: "Comentario no encontrado" });
      return;
    }

    if (body.data.texto === undefined) {
      reply.send(fila.comentario);
      return;
    }

    const [comentario] = await db
      .update(comentarios)
      .set({ texto: body.data.texto, updatedAt: new Date() })
      .where(eq(comentarios.id, params.data.id))
      .returning();

    if (!comentario) {
      reply.code(404).send({ mensaje: "Comentario no encontrado" });
      return;
    }

    reply.send(comentario);
  });

  app.delete("/comentarios/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const fila = await obtenerComentarioPropio(db, params.data.id, usuario.id);
    if (!fila || fila.comentario.usuarioId !== usuario.id) {
      reply.code(404).send({ mensaje: "Comentario no encontrado" });
      return;
    }

    await db.delete(comentarios).where(eq(comentarios.id, params.data.id));

    reply.code(204).send();
  });
}
