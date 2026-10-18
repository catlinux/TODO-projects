import { type FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  esquemaMoverTarea,
  esquemaTarea,
  esquemaTareaParcial,
  type Portada,
  ZONA_POR_DEFECTO,
} from "@todo/shared";

import {
  checklistItems,
  columnas,
  comentarios,
  proyectos,
  tareas,
  tareasEtiquetas,
} from "./db/schema.js";
import type { Database } from "./db/index.js";
import type { ConfigArchivos } from "./config.js";
import { instantaneaTarea, registrarActividad } from "./actividad.js";
import { registrarHistorial } from "./historial.js";
import { colocarTareaEnColumna, reindexarColumna } from "./tablero-posiciones.js";
import {
  adjuntosPorTarea,
  eliminarFicheros,
  esImagenAdjuntaATarea,
  recogerArchivosDeTarea,
} from "./almacen-archivos.js";

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
  portada?: Portada | null;
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

/** Etiquetas (ids) de varias tareas en una sola consulta. */
async function etiquetasPorTarea(db: Database, tareaIds: string[]): Promise<Map<string, string[]>> {
  const porTarea = new Map<string, string[]>();
  if (tareaIds.length === 0) {
    return porTarea;
  }

  const relaciones = await db
    .select({ tareaId: tareasEtiquetas.tareaId, etiquetaId: tareasEtiquetas.etiquetaId })
    .from(tareasEtiquetas)
    .where(inArray(tareasEtiquetas.tareaId, tareaIds));

  for (const relacion of relaciones) {
    const lista = porTarea.get(relacion.tareaId) ?? [];
    lista.push(relacion.etiquetaId);
    porTarea.set(relacion.tareaId, lista);
  }

  return porTarea;
}

/** Resumen {hechos, total} del checklist de varias tareas en una sola consulta agregada. */
async function checklistPorTarea(
  db: Database,
  tareaIds: string[],
): Promise<Map<string, { hechos: number; total: number }>> {
  const porTarea = new Map<string, { hechos: number; total: number }>();
  if (tareaIds.length === 0) {
    return porTarea;
  }

  const filas = await db
    .select({
      tareaId: checklistItems.tareaId,
      total: count(),
      hechos: sql<number>`count(*) filter (where ${checklistItems.hecho})`.mapWith(Number),
    })
    .from(checklistItems)
    .where(inArray(checklistItems.tareaId, tareaIds))
    .groupBy(checklistItems.tareaId);

  for (const fila of filas) {
    porTarea.set(fila.tareaId, { hechos: fila.hechos, total: fila.total });
  }

  return porTarea;
}

/** Recuento de comentarios de varias tareas en una sola consulta agregada. */
async function comentariosPorTarea(db: Database, tareaIds: string[]): Promise<Map<string, number>> {
  const porTarea = new Map<string, number>();
  if (tareaIds.length === 0) {
    return porTarea;
  }

  const filas = await db
    .select({ tareaId: comentarios.tareaId, total: count() })
    .from(comentarios)
    .where(inArray(comentarios.tareaId, tareaIds))
    .groupBy(comentarios.tareaId);

  for (const fila of filas) {
    porTarea.set(fila.tareaId, fila.total);
  }

  return porTarea;
}

/**
 * Tareas de un proyecto con etiquetas, checklist y recuento de comentarios.
 * Lo comparten `GET /proyectos/:id/tareas` y `GET /bandeja`.
 */
export async function listarTareasDeProyecto(db: Database, proyectoId: string) {
  const filas = await db
    .select()
    .from(tareas)
    .leftJoin(columnas, eq(tareas.columnaId, columnas.id))
    .where(eq(tareas.proyectoId, proyectoId))
    .orderBy(asc(columnas.posicion), asc(tareas.posicion));

  const ids = filas.map((fila) => fila.tareas.id);

  const etiquetas = await etiquetasPorTarea(db, ids);
  const checklist = await checklistPorTarea(db, ids);
  const recuentoComentarios = await comentariosPorTarea(db, ids);
  const recuentoAdjuntos = await adjuntosPorTarea(db, ids);

  return filas.map((fila) => ({
    ...fila.tareas,
    etiquetas: etiquetas.get(fila.tareas.id) ?? [],
    checklist: checklist.get(fila.tareas.id) ?? { hechos: 0, total: 0 },
    comentarios: recuentoComentarios.get(fila.tareas.id) ?? 0,
    adjuntos: recuentoAdjuntos.get(fila.tareas.id) ?? 0,
  }));
}

export function registrarRutasTareas(
  app: FastifyInstance,
  db: Database,
  config: ConfigArchivos,
): void {
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

    return listarTareasDeProyecto(db, params.data.id);
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

      if (creada) {
        await registrarHistorial(tx, {
          tareaId: creada.id,
          usuarioId: usuario.id,
          tipo: "creada",
          datos: {},
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

    const etiquetas = await etiquetasPorTarea(db, [fila.tarea.id]);
    const checklist = await checklistPorTarea(db, [fila.tarea.id]);
    const comentariosTarea = await comentariosPorTarea(db, [fila.tarea.id]);
    const adjuntos = await adjuntosPorTarea(db, [fila.tarea.id]);

    return {
      ...fila.tarea,
      etiquetas: etiquetas.get(fila.tarea.id) ?? [],
      checklist: checklist.get(fila.tarea.id) ?? { hechos: 0, total: 0 },
      comentarios: comentariosTarea.get(fila.tarea.id) ?? 0,
      adjuntos: adjuntos.get(fila.tarea.id) ?? 0,
    };
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

    if (body.data.portada?.tipo === "imagen") {
      const valida = await esImagenAdjuntaATarea(
        db,
        body.data.portada.archivoId,
        params.data.id,
        usuario.id,
      );
      if (!valida) {
        reply.code(400).send({ mensaje: "La portada debe ser una imagen adjunta a esta tarea" });
        return;
      }
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

    const cambiaDeColumna = moving && columnaDestinoId !== tareaActual.columnaId;
    let nombresColumnas: { desde: string; hasta: string } | null = null;
    if (cambiaDeColumna) {
      const filasColumnas = await db
        .select({ id: columnas.id, nombre: columnas.nombre })
        .from(columnas)
        .where(inArray(columnas.id, [tareaActual.columnaId, columnaDestinoId]));

      const columnaOrigen = filasColumnas.find(
        (filaColumna) => filaColumna.id === tareaActual.columnaId,
      );
      const columnaDestino = filasColumnas.find(
        (filaColumna) => filaColumna.id === columnaDestinoId,
      );

      if (columnaOrigen && columnaDestino) {
        nombresColumnas = { desde: columnaOrigen.nombre, hasta: columnaDestino.nombre };
      }
    }

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
    if (body.data.portada !== undefined) cambios.portada = body.data.portada;
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

      if (nombresColumnas) {
        await registrarHistorial(tx, {
          tareaId: params.data.id,
          usuarioId: usuario.id,
          tipo: "movida",
          datos: {
            desdeColumnaId: tareaActual.columnaId,
            hastaColumnaId: columnaDestinoId,
            desde: nombresColumnas.desde,
            hasta: nombresColumnas.hasta,
          },
        });
      }

      if (body.data.venceEn !== undefined) {
        const antesFecha = tareaActual.venceEn ? tareaActual.venceEn.toISOString() : null;
        const despuesFecha = venceEnResultante ? venceEnResultante.toISOString() : null;
        if (antesFecha !== despuesFecha) {
          await registrarHistorial(tx, {
            tareaId: params.data.id,
            usuarioId: usuario.id,
            tipo: "fecha",
            datos: { antes: antesFecha, despues: despuesFecha },
          });
        }
      }

      if (body.data.portada !== undefined) {
        const antesPortada = tareaActual.portada ?? null;
        const despuesPortada = body.data.portada ?? null;
        if (JSON.stringify(antesPortada) !== JSON.stringify(despuesPortada)) {
          await registrarHistorial(tx, {
            tareaId: params.data.id,
            usuarioId: usuario.id,
            tipo: "portada",
            datos: { antes: antesPortada, despues: despuesPortada },
          });
        }
      }

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

  app.post("/tareas/:id/mover", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const body = esquemaMoverTarea.safeParse(request.body);
    if (!body.success) {
      reply.code(400).send({ mensaje: "Datos de movimiento no válidos" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    // La columna debe pertenecer al proyecto destino y este al usuario.
    const [destino] = await db
      .select({ proyecto: proyectos, columna: columnas })
      .from(columnas)
      .innerJoin(proyectos, eq(columnas.proyectoId, proyectos.id))
      .where(
        and(
          eq(columnas.id, body.data.columnaId),
          eq(columnas.proyectoId, body.data.proyectoId),
          eq(proyectos.propietarioId, usuario.id),
        ),
      )
      .limit(1);

    if (!destino) {
      reply.code(404).send({ mensaje: "Proyecto o columna no encontrados" });
      return;
    }

    const tareaActual = fila.tarea;
    const cambiaDeProyecto = tareaActual.proyectoId !== destino.proyecto.id;

    const [columnaOrigen] = await db
      .select({ nombre: columnas.nombre })
      .from(columnas)
      .where(eq(columnas.id, tareaActual.columnaId))
      .limit(1);

    await db.transaction(async (tx) => {
      // Sin posición explícita, la tarea queda al final de la columna destino.
      const posicion = await colocarTareaEnColumna(tx, {
        tareaId: params.data.id,
        columnaOrigenId: tareaActual.columnaId,
        columnaDestinoId: destino.columna.id,
      });

      const updatedAt = new Date();
      await tx
        .update(tareas)
        .set({
          proyectoId: destino.proyecto.id,
          columnaId: destino.columna.id,
          posicion,
          updatedAt,
        })
        .where(eq(tareas.id, params.data.id));

      if (cambiaDeProyecto) {
        // Las etiquetas son del proyecto: al cambiar de proyecto se pierden.
        await tx.delete(tareasEtiquetas).where(eq(tareasEtiquetas.tareaId, params.data.id));

        await registrarHistorial(tx, {
          tareaId: params.data.id,
          usuarioId: usuario.id,
          tipo: "proyecto",
          datos: {
            desdeProyectoId: tareaActual.proyectoId,
            hastaProyectoId: destino.proyecto.id,
            desde: fila.proyecto.nombre,
            hasta: destino.proyecto.nombre,
          },
        });
      } else if (tareaActual.columnaId !== destino.columna.id) {
        await registrarHistorial(tx, {
          tareaId: params.data.id,
          usuarioId: usuario.id,
          tipo: "movida",
          datos: {
            desdeColumnaId: tareaActual.columnaId,
            hastaColumnaId: destino.columna.id,
            desde: columnaOrigen?.nombre ?? "",
            hasta: destino.columna.nombre,
          },
        });
      }

      if (request.tokenId) {
        await registrarActividad(tx, {
          usuarioId: usuario.id,
          tokenId: request.tokenId,
          tokenNombre: request.tokenNombre,
          accion: "editar",
          entidadId: params.data.id,
          antes: instantaneaTarea(tareaActual),
          despues: instantaneaTarea({
            ...tareaActual,
            proyectoId: destino.proyecto.id,
            columnaId: destino.columna.id,
            posicion,
            updatedAt,
          }),
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
    // Los ids se recogen antes de borrar las filas: la cascada se lleva los archivos.
    const idsArchivos = await recogerArchivosDeTarea(db, params.data.id);

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

    await eliminarFicheros(config.dir, idsArchivos);

    reply.code(204).send();
  });
}
