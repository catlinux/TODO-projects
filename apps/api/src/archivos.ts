import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { type FastifyInstance, type FastifyRequest } from "fastify";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { archivos, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import type { ConfigArchivos } from "./config.js";
import { registrarHistorial } from "./historial.js";
import { obtenerTareaPropia } from "./tareas.js";
import {
  eliminarFicheros,
  FONDO_POR_DEFECTO,
  guardarFichero,
  MIME_OCTET_STREAM,
  detectarImagenPermitida,
  rutaArchivo,
  sanearNombreArchivo,
} from "./almacen-archivos.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

export const MAX_ADJUNTOS_TAREA = 20;
export const MAX_FONDOS_PROYECTO = 10;

const CAMPO_ARCHIVO = "archivo";

type ResultadoSubida =
  { ok: true; contenido: Buffer; nombre: string } | { ok: false; estado: number; mensaje: string };

/** Lee el único fichero multipart del campo `archivo`, controlando los límites. */
async function leerArchivoSubido(request: FastifyRequest): Promise<ResultadoSubida> {
  let parte;
  try {
    parte = await request.file();
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === "FST_REQ_FILE_TOO_LARGE") {
      return { ok: false, estado: 413, mensaje: "El archivo supera el tamaño máximo" };
    }
    return { ok: false, estado: 400, mensaje: "Petición multipart no válida" };
  }

  if (!parte) {
    return { ok: false, estado: 400, mensaje: "Falta el archivo (campo «archivo»)" };
  }

  if (parte.fieldname !== CAMPO_ARCHIVO) {
    parte.file.resume();
    return { ok: false, estado: 400, mensaje: "Campo de archivo no válido" };
  }

  try {
    const contenido = await parte.toBuffer();
    return { ok: true, contenido, nombre: sanearNombreArchivo(parte.filename) };
  } catch (error) {
    const codigo = (error as { code?: string }).code;
    if (codigo === "FST_REQ_FILE_TOO_LARGE") {
      return { ok: false, estado: 413, mensaje: "El archivo supera el tamaño máximo" };
    }
    return { ok: false, estado: 400, mensaje: "No se pudo leer el archivo" };
  }
}

const CARACTERES_RFC5987 = /['()*]/g;

/** Content-Disposition sin inyección de cabeceras y con filename* escapado. */
function cabeceraDisposicion(nombre: string, enLinea: boolean): string {
  const nombreAscii = nombre.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const escapado = encodeURIComponent(nombre).replace(
    CARACTERES_RFC5987,
    (caracter) => `%${caracter.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const disposicion = enLinea ? "inline" : "attachment";
  return `${disposicion}; filename="${nombreAscii}"; filename*=UTF-8''${escapado}`;
}

async function obtenerArchivoPropio(db: Database, id: string, usuarioId: string) {
  const [fila] = await db
    .select()
    .from(archivos)
    .where(and(eq(archivos.id, id), eq(archivos.usuarioId, usuarioId)))
    .limit(1);

  return fila ?? null;
}

export function registrarRutasArchivos(
  app: FastifyInstance,
  db: Database,
  config: ConfigArchivos,
): void {
  app.post("/tareas/:id/archivos", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const subida = await leerArchivoSubido(request);
    if (!subida.ok) {
      reply.code(subida.estado).send({ mensaje: subida.mensaje });
      return;
    }

    const id = randomUUID();
    const mime = detectarImagenPermitida(subida.contenido) ?? MIME_OCTET_STREAM;
    const tamano = subida.contenido.length;

    let resultado;
    try {
      resultado = await db.transaction(async (tx) => {
        // Bloquea la fila de la tarea para que dos subidas simultáneas no superen el límite.
        const [tarea] = await tx
          .select({ id: tareas.id })
          .from(tareas)
          .where(eq(tareas.id, params.data.id))
          .for("update")
          .limit(1);
        if (!tarea) return { tipo: "sinTarea" as const };

        const [recuento] = await tx
          .select({ total: count() })
          .from(archivos)
          .where(eq(archivos.tareaId, params.data.id));
        if ((recuento?.total ?? 0) >= MAX_ADJUNTOS_TAREA) {
          return { tipo: "limite" as const };
        }

        // Solo se escribe en disco si el límite permite insertar la fila.
        await guardarFichero(config.dir, id, subida.contenido);

        const [archivo] = await tx
          .insert(archivos)
          .values({
            id,
            usuarioId: usuario.id,
            tareaId: params.data.id,
            nombre: subida.nombre,
            mime,
            tamano,
          })
          .returning();

        if (!archivo) return { tipo: "error" as const };

        await registrarHistorial(tx, {
          tareaId: params.data.id,
          usuarioId: usuario.id,
          tipo: "adjunto",
          datos: { accion: "añadido", nombre: subida.nombre, archivoId: id },
        });

        return { tipo: "ok" as const, archivo };
      });
    } catch (error) {
      await eliminarFicheros(config.dir, [id]);
      throw error;
    }

    if (resultado.tipo === "sinTarea") {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    if (resultado.tipo === "limite") {
      reply.code(400).send({ mensaje: "La tarea admite como máximo 20 adjuntos" });
      return;
    }

    if (resultado.tipo !== "ok") {
      await eliminarFicheros(config.dir, [id]);
      reply.code(500).send({ mensaje: "No se pudo guardar el archivo" });
      return;
    }

    reply.code(201).send(resultado.archivo);
  });

  app.post("/proyectos/:id/fondos", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const subida = await leerArchivoSubido(request);
    if (!subida.ok) {
      reply.code(subida.estado).send({ mensaje: subida.mensaje });
      return;
    }

    const mime = detectarImagenPermitida(subida.contenido);
    if (!mime) {
      reply.code(400).send({ mensaje: "El fondo debe ser una imagen png, jpeg, webp o gif" });
      return;
    }

    const id = randomUUID();

    let resultado;
    try {
      resultado = await db.transaction(async (tx) => {
        // Bloquea la fila del proyecto para que dos subidas simultáneas no superen el límite.
        const [proyectoBloqueado] = await tx
          .select({ id: proyectos.id })
          .from(proyectos)
          .where(and(eq(proyectos.id, params.data.id), eq(proyectos.propietarioId, usuario.id)))
          .for("update")
          .limit(1);
        if (!proyectoBloqueado) return { tipo: "sinProyecto" as const };

        const [recuento] = await tx
          .select({ total: count() })
          .from(archivos)
          .where(eq(archivos.proyectoId, params.data.id));
        if ((recuento?.total ?? 0) >= MAX_FONDOS_PROYECTO) {
          return { tipo: "limite" as const };
        }

        // Solo se escribe en disco si el límite permite insertar la fila.
        await guardarFichero(config.dir, id, subida.contenido);

        const [archivo] = await tx
          .insert(archivos)
          .values({
            id,
            usuarioId: usuario.id,
            proyectoId: params.data.id,
            nombre: subida.nombre,
            mime,
            tamano: subida.contenido.length,
          })
          .returning();

        if (!archivo) return { tipo: "error" as const };

        return { tipo: "ok" as const, archivo };
      });
    } catch (error) {
      await eliminarFicheros(config.dir, [id]);
      throw error;
    }

    if (resultado.tipo === "sinProyecto") {
      reply.code(404).send({ mensaje: "Proyecto no encontrado" });
      return;
    }

    if (resultado.tipo === "limite") {
      reply.code(400).send({ mensaje: "El proyecto admite como máximo 10 fondos" });
      return;
    }

    if (resultado.tipo !== "ok") {
      await eliminarFicheros(config.dir, [id]);
      reply.code(500).send({ mensaje: "No se pudo guardar el fondo" });
      return;
    }

    reply.code(201).send(resultado.archivo);
  });

  app.get("/tareas/:id/archivos", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .select({
        id: archivos.id,
        nombre: archivos.nombre,
        mime: archivos.mime,
        tamano: archivos.tamano,
        createdAt: archivos.createdAt,
      })
      .from(archivos)
      .where(eq(archivos.tareaId, params.data.id))
      .orderBy(desc(archivos.createdAt));
  });

  app.get("/proyectos/:id/fondos", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .select({
        id: archivos.id,
        nombre: archivos.nombre,
        mime: archivos.mime,
        tamano: archivos.tamano,
        createdAt: archivos.createdAt,
      })
      .from(archivos)
      .where(eq(archivos.proyectoId, params.data.id))
      .orderBy(desc(archivos.createdAt));
  });

  app.get("/archivos/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const fila = await obtenerArchivoPropio(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Archivo no encontrado" });
      return;
    }

    const ruta = rutaArchivo(config.dir, fila.id);
    try {
      await access(ruta);
    } catch {
      reply.code(404).send({ mensaje: "Archivo no encontrado" });
      return;
    }

    const enLinea = fila.mime !== MIME_OCTET_STREAM;

    reply
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      )
      .header("Cache-Control", "private, max-age=3600")
      .header("Content-Disposition", cabeceraDisposicion(fila.nombre, enLinea))
      .header("Content-Length", String(fila.tamano))
      .type(fila.mime);

    return reply.send(createReadStream(ruta));
  });

  app.delete("/archivos/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const fila = await obtenerArchivoPropio(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Archivo no encontrado" });
      return;
    }

    await db.transaction(async (tx) => {
      if (fila.tareaId) {
        const [tarea] = await tx.select().from(tareas).where(eq(tareas.id, fila.tareaId)).limit(1);
        const portada = tarea?.portada as { tipo?: string; archivoId?: string } | null | undefined;
        if (portada?.tipo === "imagen" && portada.archivoId === fila.id) {
          await tx
            .update(tareas)
            .set({ portada: null, updatedAt: new Date() })
            .where(eq(tareas.id, fila.tareaId));
        }
      }

      if (fila.proyectoId) {
        const [proyecto] = await tx
          .select()
          .from(proyectos)
          .where(eq(proyectos.id, fila.proyectoId))
          .limit(1);
        const fondo = proyecto?.fondo as { tipo?: string; ids?: unknown } | null | undefined;
        if (fondo?.tipo === "imagenes" && Array.isArray(fondo.ids) && fondo.ids.includes(fila.id)) {
          const ids = fondo.ids.filter((valor) => valor !== fila.id);
          const nuevoFondo = ids.length > 0 ? { ...fondo, ids } : FONDO_POR_DEFECTO;
          await tx
            .update(proyectos)
            .set({ fondo: nuevoFondo, updatedAt: new Date() })
            .where(eq(proyectos.id, fila.proyectoId));
        }
      }

      await tx.delete(archivos).where(eq(archivos.id, fila.id));

      if (fila.tareaId) {
        await registrarHistorial(tx, {
          tareaId: fila.tareaId,
          usuarioId: usuario.id,
          tipo: "adjunto",
          datos: { accion: "quitado", nombre: fila.nombre, archivoId: fila.id },
        });
      }
    });

    await eliminarFicheros(config.dir, [fila.id]);

    reply.code(204).send();
  });
}
