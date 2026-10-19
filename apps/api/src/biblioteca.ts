import { randomUUID } from "node:crypto";

import { type FastifyInstance } from "fastify";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { FondoProyecto } from "@todo/shared";

import { archivos, usuarios } from "./db/schema.js";
import type { Database } from "./db/index.js";
import type { ConfigArchivos } from "./config.js";
import { leerArchivoSubido } from "./archivos.js";
import {
  detectarImagenPermitida,
  eliminarFicheros,
  FONDO_POR_DEFECTO,
  guardarFichero,
  quitarArchivoDeFondos,
} from "./almacen-archivos.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

export const MAX_IMAGENES_BIBLIOTECA = 300;
export const CANTIDAD_FONDO_ALEATORIO = 7;
export const INTERVALO_FONDO_ALEATORIO = 60;

/** Admite tanto la base de datos como una transacción en curso. */
type Ejecutor = Pick<Database, "select">;

export interface OpcionesBiblioteca {
  /** Límite de imágenes por usuario; las pruebas lo bajan para no subir 300. */
  maxImagenes?: number;
}

/**
 * Fondo inicial de un proyecto nuevo: hasta `cantidad` imágenes al azar de la
 * biblioteca del usuario o, si no tiene ninguna, el ambiente de siempre.
 */
export async function elegirFondoAleatorio(
  ejecutor: Ejecutor,
  usuarioId: string,
  cantidad = CANTIDAD_FONDO_ALEATORIO,
): Promise<FondoProyecto> {
  const limite = Math.max(1, Math.trunc(cantidad));

  const filas = await ejecutor
    .select({ id: archivos.id })
    .from(archivos)
    .where(and(eq(archivos.usuarioId, usuarioId), eq(archivos.biblioteca, true)))
    .orderBy(sql`random()`)
    .limit(limite);

  if (filas.length === 0) {
    return FONDO_POR_DEFECTO;
  }

  return {
    tipo: "imagenes",
    ids: filas.map((fila) => fila.id),
    intervaloSeg: INTERVALO_FONDO_ALEATORIO,
  };
}

export function registrarRutasBiblioteca(
  app: FastifyInstance,
  db: Database,
  config: ConfigArchivos,
  opciones: OpcionesBiblioteca = {},
): void {
  const maxImagenes = opciones.maxImagenes ?? MAX_IMAGENES_BIBLIOTECA;

  app.post("/biblioteca", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const subida = await leerArchivoSubido(request);
    if (!subida.ok) {
      reply.code(subida.estado).send({ mensaje: subida.mensaje });
      return;
    }

    const mime = detectarImagenPermitida(subida.contenido);
    if (!mime) {
      reply.code(400).send({ mensaje: "La imagen debe ser png, jpeg, webp o gif" });
      return;
    }

    const id = randomUUID();

    let resultado;
    try {
      resultado = await db.transaction(async (tx) => {
        // Bloquea la fila del usuario para que dos subidas simultáneas no superen el límite.
        const [propietario] = await tx
          .select({ id: usuarios.id })
          .from(usuarios)
          .where(eq(usuarios.id, usuario.id))
          .for("update")
          .limit(1);
        if (!propietario) return { tipo: "sinUsuario" as const };

        const [recuento] = await tx
          .select({ total: count() })
          .from(archivos)
          .where(and(eq(archivos.usuarioId, usuario.id), eq(archivos.biblioteca, true)));
        if ((recuento?.total ?? 0) >= maxImagenes) {
          return { tipo: "limite" as const };
        }

        // Solo se escribe en disco si el límite permite insertar la fila.
        await guardarFichero(config.dir, id, subida.contenido);

        const [archivo] = await tx
          .insert(archivos)
          .values({
            id,
            usuarioId: usuario.id,
            biblioteca: true,
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

    if (resultado.tipo === "sinUsuario") {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    if (resultado.tipo === "limite") {
      reply
        .code(400)
        .send({ mensaje: `La biblioteca admite como máximo ${maxImagenes} imágenes` });
      return;
    }

    if (resultado.tipo !== "ok") {
      await eliminarFicheros(config.dir, [id]);
      reply.code(500).send({ mensaje: "No se pudo guardar la imagen" });
      return;
    }

    reply.code(201).send(resultado.archivo);
  });

  app.get("/biblioteca", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
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
      .where(and(eq(archivos.usuarioId, usuario.id), eq(archivos.biblioteca, true)))
      .orderBy(desc(archivos.createdAt));
  });

  app.post("/biblioteca/aleatorias", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const fondo = await elegirFondoAleatorio(db, usuario.id);
    if (fondo.tipo !== "imagenes") {
      reply.code(404).send({ mensaje: "La biblioteca no tiene imágenes" });
      return;
    }

    return { ids: fondo.ids };
  });

  app.delete("/biblioteca/:id", { preHandler: app.requireAuth }, async (request, reply) => {
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
      .select()
      .from(archivos)
      .where(
        and(
          eq(archivos.id, params.data.id),
          eq(archivos.usuarioId, usuario.id),
          eq(archivos.biblioteca, true),
        ),
      )
      .limit(1);

    if (!fila) {
      reply.code(404).send({ mensaje: "Imagen no encontrada" });
      return;
    }

    await db.transaction(async (tx) => {
      await quitarArchivoDeFondos(tx, usuario.id, fila.id);
      await tx.delete(archivos).where(eq(archivos.id, fila.id));
    });

    await eliminarFicheros(config.dir, [fila.id]);

    reply.code(204).send();
  });
}
