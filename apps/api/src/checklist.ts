import { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaChecklistItem, esquemaChecklistItemParcial } from "@todo/shared";

import { checklistItems, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { instantaneaTarea, registrarActividad } from "./actividad.js";
import { registrarHistorial } from "./historial.js";
import { obtenerTareaPropia } from "./tareas.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

export const MAX_ELEMENTOS_CHECKLIST = 200;

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function reindexarChecklist(tx: Tx, tareaId: string, idsEnOrden: string[]): Promise<void> {
  for (let i = 0; i < idsEnOrden.length; i += 1) {
    await tx
      .update(checklistItems)
      .set({ posicion: i })
      .where(eq(checklistItems.id, idsEnOrden[i]!));
  }
}

async function obtenerElementoPropio(db: Database, id: string, usuarioId: string) {
  const [fila] = await db
    .select({ elemento: checklistItems, tarea: tareas })
    .from(checklistItems)
    .innerJoin(tareas, eq(checklistItems.tareaId, tareas.id))
    .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
    .where(and(eq(checklistItems.id, id), eq(proyectos.propietarioId, usuarioId)))
    .limit(1);

  return fila ?? null;
}

export function registrarRutasChecklist(app: FastifyInstance, db: Database): void {
  app.get("/tareas/:id/checklist", { preHandler: app.requireAuth }, async (request, reply) => {
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

    return db
      .select()
      .from(checklistItems)
      .where(eq(checklistItems.tareaId, params.data.id))
      .orderBy(asc(checklistItems.posicion));
  });

  app.post("/tareas/:id/checklist", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaChecklistItem.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos del elemento no válidos" });
      return;
    }

    let lleno = false;
    const creado = await db.transaction(async (tx) => {
      const existentes = await tx
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(eq(checklistItems.tareaId, params.data.id));

      if (existentes.length >= MAX_ELEMENTOS_CHECKLIST) {
        lleno = true;
        return undefined;
      }

      const [elemento] = await tx
        .insert(checklistItems)
        .values({
          tareaId: params.data.id,
          texto: body.data.texto,
          descripcion: body.data.descripcion?.trim() || null,
          posicion: existentes.length,
        })
        .returning();

      if (elemento && request.tokenId) {
        // La actividad va sobre la tarea y con instantáneas iguales: deshacerla no la modifica.
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

      return elemento;
    });

    if (lleno) {
      reply.code(400).send({ mensaje: "El checklist admite como máximo 200 elementos" });
      return;
    }

    if (!creado) {
      reply.code(500).send({ mensaje: "No se pudo crear el elemento" });
      return;
    }

    reply.code(201).send(creado);
  });

  app.patch("/checklist/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaChecklistItemParcial.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos del elemento no válidos" });
      return;
    }

    const fila = await obtenerElementoPropio(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Elemento no encontrado" });
      return;
    }

    const cambios: { texto?: string; descripcion?: string | null; hecho?: boolean; posicion?: number } =
      {};
    if (body.data.texto !== undefined) cambios.texto = body.data.texto;
    if (body.data.hecho !== undefined) cambios.hecho = body.data.hecho;

    let cambiaDescripcion = false;
    if (body.data.descripcion !== undefined) {
      // Vacío o null borra la descripción.
      const descripcion = body.data.descripcion?.trim() || null;
      if (descripcion !== fila.elemento.descripcion) {
        cambios.descripcion = descripcion;
        cambiaDescripcion = true;
      }
    }

    // Sin campos ni posición no hay nada que actualizar (evita un UPDATE vacío).
    if (body.data.posicion === undefined && Object.keys(cambios).length === 0) {
      reply.send(fila.elemento);
      return;
    }

    const actualizado = await db.transaction(async (tx) => {
      if (body.data.posicion !== undefined) {
        const elementos = await tx
          .select({ id: checklistItems.id })
          .from(checklistItems)
          .where(eq(checklistItems.tareaId, fila.elemento.tareaId))
          .orderBy(asc(checklistItems.posicion));

        const sinActual = elementos
          .map((elemento) => elemento.id)
          .filter((id) => id !== params.data.id);
        const posicionFinal = Math.min(Math.max(body.data.posicion, 0), sinActual.length);

        const orden = [...sinActual];
        orden.splice(posicionFinal, 0, params.data.id);
        await reindexarChecklist(tx, fila.elemento.tareaId, orden);
        cambios.posicion = posicionFinal;
      }

      const [elemento] = await tx
        .update(checklistItems)
        .set(cambios)
        .where(eq(checklistItems.id, params.data.id))
        .returning();

      if (elemento && body.data.hecho === true && fila.elemento.hecho === false) {
        await registrarHistorial(tx, {
          tareaId: fila.elemento.tareaId,
          usuarioId: usuario.id,
          tipo: "checklist",
          datos: { texto: elemento.texto },
        });
      }

      if (elemento && cambiaDescripcion) {
        await registrarHistorial(tx, {
          tareaId: fila.elemento.tareaId,
          usuarioId: usuario.id,
          tipo: "descripcion",
          datos: { texto: elemento.texto },
        });
      }

      if (elemento && request.tokenId) {
        const instantanea = instantaneaTarea(fila.tarea);
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "editar",
          entidadId: fila.elemento.tareaId,
          antes: instantanea,
          despues: instantanea,
        });
      }

      return elemento;
    });

    if (!actualizado) {
      reply.code(404).send({ mensaje: "Elemento no encontrado" });
      return;
    }

    reply.send(actualizado);
  });

  app.delete("/checklist/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const fila = await obtenerElementoPropio(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Elemento no encontrado" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx.delete(checklistItems).where(eq(checklistItems.id, params.data.id));

      const restantes = await tx
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(eq(checklistItems.tareaId, fila.elemento.tareaId))
        .orderBy(asc(checklistItems.posicion));

      await reindexarChecklist(
        tx,
        fila.elemento.tareaId,
        restantes.map((elemento) => elemento.id),
      );

      if (request.tokenId) {
        const instantanea = instantaneaTarea(fila.tarea);
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "editar",
          entidadId: fila.elemento.tareaId,
          antes: instantanea,
          despues: instantanea,
        });
      }
    });

    reply.code(204).send();
  });
}
