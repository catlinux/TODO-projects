import { type FastifyInstance, type FastifyReply } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaProyecto, esquemaProyectoParcial, type FondoProyecto } from "@todo/shared";

import { columnas, proyectos } from "./db/schema.js";
import type { Database } from "./db/index.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

type RespuestaError = { mensaje: string };

function responderValidacion(reply: FastifyReply, mensaje: string): void {
  reply.code(400).send({ mensaje } satisfies RespuestaError);
}

export function registrarRutasProyectos(app: FastifyInstance, db: Database): void {
  app.get("/proyectos", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    return db
      .select()
      .from(proyectos)
      .where(and(eq(proyectos.propietarioId, usuario.id), eq(proyectos.esBandeja, false)))
      .orderBy(asc(proyectos.createdAt));
  });

  app.post("/proyectos", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const resultado = esquemaProyecto.safeParse(request.body);
    if (!resultado.success) {
      responderValidacion(reply, "Datos de proyecto no válidos");
      return;
    }

    const proyecto = await db.transaction(async (tx) => {
      const [creado] = await tx
        .insert(proyectos)
        .values({
          nombre: resultado.data.nombre,
          descripcion: resultado.data.descripcion,
          propietarioId: usuario.id,
        })
        .returning();

      if (!creado) return null;

      await tx.insert(columnas).values([
        { proyectoId: creado.id, nombre: "Pendiente", posicion: 0 },
        { proyectoId: creado.id, nombre: "En curso", posicion: 1 },
        { proyectoId: creado.id, nombre: "Hecha", posicion: 2 },
      ]);

      return creado;
    });

    if (!proyecto) {
      reply.code(500).send({ mensaje: "No se pudo crear el proyecto" });
      return;
    }

    reply.code(201).send(proyecto);
  });

  app.get("/proyectos/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      responderValidacion(reply, "Identificador no válido");
      return;
    }

    const [proyecto] = await db
      .select()
      .from(proyectos)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!proyecto) {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    return proyecto;
  });

  app.patch("/proyectos/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      responderValidacion(reply, "Identificador no válido");
      return;
    }

    const body = esquemaProyectoParcial.safeParse(request.body);
    if (!body.success) {
      responderValidacion(reply, "Datos de proyecto no válidos");
      return;
    }

    const existente = await db
      .select({ id: proyectos.id, esBandeja: proyectos.esBandeja })
      .from(proyectos)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (existente.length === 0) {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    // La bandeja de entrada no se puede renombrar (sí cambiar su color o fondo).
    if (existente[0]?.esBandeja && body.data.nombre !== undefined) {
      reply.code(400).send({ mensaje: "La bandeja de entrada no se puede renombrar" });
      return;
    }

    if (body.data.fondo?.tipo === "imagenes") {
      responderValidacion(reply, "Todavía no se admiten imágenes de fondo");
      return;
    }

    const cambios: {
      nombre?: string;
      descripcion?: string;
      color?: string | null;
      fondo?: FondoProyecto;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (body.data.nombre !== undefined) {
      cambios.nombre = body.data.nombre;
    }
    if (body.data.descripcion !== undefined) {
      cambios.descripcion = body.data.descripcion;
    }
    if (body.data.color !== undefined) {
      cambios.color = body.data.color;
    }
    if (body.data.fondo !== undefined) {
      cambios.fondo = body.data.fondo;
    }

    const [proyecto] = await db
      .update(proyectos)
      .set(cambios)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .returning();

    if (!proyecto) {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    reply.send(proyecto);
  });

  app.delete("/proyectos/:id", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      responderValidacion(reply, "Identificador no válido");
      return;
    }

    const existente = await db
      .select({ id: proyectos.id, esBandeja: proyectos.esBandeja })
      .from(proyectos)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (existente.length === 0) {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    if (existente[0]?.esBandeja) {
      reply.code(409).send({ mensaje: "La bandeja de entrada no se puede borrar" });
      return;
    }

    await db
      .delete(proyectos)
      .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)));

    reply.code(204).send();
  });
}
