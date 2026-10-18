import { type FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { esquemaEtiqueta, esquemaEtiquetaParcial, esquemaEtiquetasTarea } from "@todo/shared";

import { etiquetas, proyectos, tareasEtiquetas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { instantaneaTarea, registrarActividad } from "./actividad.js";
import { obtenerTareaPropia } from "./tareas.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

async function obtenerEtiquetaPropia(db: Database, id: string, usuarioId: string) {
  const [fila] = await db
    .select({ etiqueta: etiquetas })
    .from(etiquetas)
    .innerJoin(proyectos, eq(etiquetas.proyectoId, proyectos.id))
    .where(and(eq(etiquetas.id, id), eq(proyectos.propietarioId, usuarioId)))
    .limit(1);

  return fila ?? null;
}

async function nombreRepetido(
  db: Database,
  proyectoId: string,
  nombre: string,
  excluirId: string,
): Promise<boolean> {
  const existentes = await db
    .select({ id: etiquetas.id, nombre: etiquetas.nombre })
    .from(etiquetas)
    .where(eq(etiquetas.proyectoId, proyectoId));

  const objetivo = nombre.toLowerCase();
  return existentes.some(
    (etiqueta) => etiqueta.id !== excluirId && etiqueta.nombre.toLowerCase() === objetivo,
  );
}

export function registrarRutasEtiquetas(app: FastifyInstance, db: Database): void {
  app.get("/proyectos/:id/etiquetas", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .from(etiquetas)
      .where(eq(etiquetas.proyectoId, params.data.id))
      .orderBy(asc(etiquetas.createdAt));
  });

  app.post("/proyectos/:id/etiquetas", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaEtiqueta.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de etiqueta no válidos" });
      return;
    }

    if (await nombreRepetido(db, params.data.id, body.data.nombre, "")) {
      reply.code(409).send({ mensaje: "Ya existe una etiqueta con ese nombre" });
      return;
    }

    const [etiqueta] = await db
      .insert(etiquetas)
      .values({
        proyectoId: params.data.id,
        nombre: body.data.nombre,
        color: body.data.color,
      })
      .returning();

    if (!etiqueta) {
      reply.code(500).send({ mensaje: "No se pudo crear la etiqueta" });
      return;
    }

    reply.code(201).send(etiqueta);
  });

  app.patch("/etiquetas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaEtiquetaParcial.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de etiqueta no válidos" });
      return;
    }

    const fila = await obtenerEtiquetaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Etiqueta no encontrada" });
      return;
    }

    if (
      body.data.nombre !== undefined &&
      (await nombreRepetido(db, fila.etiqueta.proyectoId, body.data.nombre, params.data.id))
    ) {
      reply.code(409).send({ mensaje: "Ya existe una etiqueta con ese nombre" });
      return;
    }

    const cambios: { nombre?: string; color?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (body.data.nombre !== undefined) cambios.nombre = body.data.nombre;
    if (body.data.color !== undefined) cambios.color = body.data.color;

    const [etiqueta] = await db
      .update(etiquetas)
      .set(cambios)
      .where(eq(etiquetas.id, params.data.id))
      .returning();

    if (!etiqueta) {
      reply.code(404).send({ mensaje: "Etiqueta no encontrada" });
      return;
    }

    reply.send(etiqueta);
  });

  app.delete("/etiquetas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const fila = await obtenerEtiquetaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Etiqueta no encontrada" });
      return;
    }

    await db.delete(etiquetas).where(eq(etiquetas.id, params.data.id));

    reply.code(204).send();
  });

  app.put("/tareas/:id/etiquetas", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaEtiquetasTarea.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de etiquetas no válidos" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const ids = [...new Set(body.data.ids)];

    // Todas las etiquetas deben existir y ser del mismo proyecto de la tarea.
    if (ids.length > 0) {
      const validas = await db
        .select({ id: etiquetas.id })
        .from(etiquetas)
        .where(and(eq(etiquetas.proyectoId, fila.tarea.proyectoId), inArray(etiquetas.id, ids)));

      if (validas.length !== ids.length) {
        reply.code(400).send({ mensaje: "Alguna etiqueta no pertenece al proyecto de la tarea" });
        return;
      }
    }

    const actuales = await db
      .select({ etiquetaId: tareasEtiquetas.etiquetaId })
      .from(tareasEtiquetas)
      .where(eq(tareasEtiquetas.tareaId, params.data.id));

    const antes = actuales.map((relacion) => relacion.etiquetaId).sort();
    const despues = [...ids].sort();

    await db.transaction(async (tx) => {
      await tx.delete(tareasEtiquetas).where(eq(tareasEtiquetas.tareaId, params.data.id));

      if (ids.length > 0) {
        await tx
          .insert(tareasEtiquetas)
          .values(ids.map((etiquetaId) => ({ tareaId: params.data.id, etiquetaId })));
      }

      if (request.tokenId && JSON.stringify(antes) !== JSON.stringify(despues)) {
        const instantanea = instantaneaTarea(fila.tarea);
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "editar",
          entidadId: params.data.id,
          antes: instantanea,
          despues: instantanea,
        });
      }
    });

    reply.send({ ...fila.tarea, etiquetas: ids });
  });
}
