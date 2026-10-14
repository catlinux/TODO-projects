import { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaColumna, esquemaColumnaParcial } from "@todo/shared";

import { columnas, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

export function registrarRutasColumnas(app: FastifyInstance, db: Database): void {
  app.get("/proyectos/:id/columnas", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .from(columnas)
      .where(eq(columnas.proyectoId, params.data.id))
      .orderBy(asc(columnas.posicion));
  });

  app.post("/proyectos/:id/columnas", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaColumna.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de columna no válidos" });
      return;
    }

    const existentes = await db
      .select({ id: columnas.id })
      .from(columnas)
      .where(eq(columnas.proyectoId, params.data.id));

    const [columna] = await db
      .insert(columnas)
      .values({
        proyectoId: params.data.id,
        nombre: body.data.nombre,
        posicion: existentes.length,
      })
      .returning();

    if (!columna) {
      reply.code(500).send({ mensaje: "No se pudo crear la columna" });
      return;
    }

    reply.code(201).send(columna);
  });

  app.patch("/columnas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .select({ columna: columnas, proyecto: proyectos })
      .from(columnas)
      .innerJoin(proyectos, eq(columnas.proyectoId, proyectos.id))
      .where(and(eq(columnas.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!fila) {
      reply.code(404).send({ mensaje: "Columna no encontrada" });
      return;
    }

    const body = esquemaColumnaParcial.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de columna no válidos" });
      return;
    }

    const todas = await db
      .select()
      .from(columnas)
      .where(eq(columnas.proyectoId, fila.columna.proyectoId))
      .orderBy(asc(columnas.posicion));

    const indiceActual = todas.findIndex((c) => c.id === params.data.id);
    let indiceNuevo = indiceActual;

    if (body.data.posicion !== undefined) {
      indiceNuevo = Math.min(Math.max(body.data.posicion, 0), todas.length - 1);
    }

    if (indiceNuevo !== indiceActual) {
      const reordenadas = [...todas];
      const movida = reordenadas.splice(indiceActual, 1)[0]!; // no-null assert
      reordenadas.splice(indiceNuevo, 0, movida);

      await db.transaction(async (tx) => {
        for (let i = 0; i < reordenadas.length; i += 1) {
          await tx
            .update(columnas)
            .set({ posicion: i, updatedAt: new Date() })
            .where(eq(columnas.id, reordenadas[i]!.id));
        }
        if (body.data.nombre !== undefined) {
          await tx
            .update(columnas)
            .set({ nombre: body.data.nombre, updatedAt: new Date() })
            .where(eq(columnas.id, params.data.id));
        }
      });
    } else if (body.data.nombre !== undefined) {
      await db
        .update(columnas)
        .set({ nombre: body.data.nombre, updatedAt: new Date() })
        .where(eq(columnas.id, params.data.id));
    }

    const [actualizada] = await db
      .select()
      .from(columnas)
      .where(eq(columnas.id, params.data.id))
      .limit(1);

    reply.send(actualizada);
  });

  app.delete("/columnas/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .select({ columna: columnas, proyecto: proyectos })
      .from(columnas)
      .innerJoin(proyectos, eq(columnas.proyectoId, proyectos.id))
      .where(and(eq(columnas.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
      .limit(1);

    if (!fila) {
      reply.code(404).send({ mensaje: "Columna no encontrada" });
      return;
    }

    const tareasDeColumna = await db
      .select({ id: tareas.id })
      .from(tareas)
      .where(eq(tareas.columnaId, params.data.id));

    if (tareasDeColumna.length > 0) {
      reply.code(409).send({ mensaje: "La columna no está vacía" });
      return;
    }

    const totalColumnas = await db
      .select({ id: columnas.id })
      .from(columnas)
      .where(eq(columnas.proyectoId, fila.columna.proyectoId));

    if (totalColumnas.length <= 1) {
      reply.code(409).send({ mensaje: "Debe quedar al menos una columna" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.delete(columnas).where(eq(columnas.id, params.data.id));

      const restantes = await tx
        .select()
        .from(columnas)
        .where(eq(columnas.proyectoId, fila.columna.proyectoId))
        .orderBy(asc(columnas.posicion));

      for (let i = 0; i < restantes.length; i += 1) {
        await tx
          .update(columnas)
          .set({ posicion: i, updatedAt: new Date() })
          .where(eq(columnas.id, restantes[i]!.id));
      }
    });

    reply.code(204).send();
  });
}
