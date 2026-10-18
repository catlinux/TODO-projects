import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { and, count, eq, inArray } from "drizzle-orm";

import type { FondoProyecto } from "@todo/shared";

import { archivos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

/** MIME con el que se sirven los ficheros que no son una imagen permitida. */
export const MIME_OCTET_STREAM = "application/octet-stream";

export const FONDO_POR_DEFECTO: FondoProyecto = { tipo: "ambiente", ambiente: "bosque" };

/**
 * Detecta el tipo de imagen por sus primeros bytes, sin fiarse del Content-Type ni
 * de la extensión. Devuelve el MIME permitido, o null si no es una de las cuatro.
 */
export function detectarImagenPermitida(bytes: Uint8Array): string | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // GIF: "GIF87a" o "GIF89a"
  if (bytes.length >= 6) {
    const cabecera = Buffer.from(bytes.subarray(0, 6)).toString("latin1");
    if (cabecera === "GIF87a" || cabecera === "GIF89a") {
      return "image/gif";
    }
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/** Sanea el nombre original: sin rutas, sin caracteres de control y como mucho 200 caracteres. */
export function sanearNombreArchivo(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? "";
  const limpio = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["'<>]/g, "")
    .trim();
  const sinPuntos = limpio.replace(/^\.+/, "").trim();
  const definitivo = sinPuntos.length > 0 ? sinPuntos : "archivo";
  return definitivo.slice(0, 200);
}

/** Ruta en disco: se construye solo con el uuid validado, sin path traversal. */
export function rutaArchivo(dir: string, id: string): string {
  return join(dir, id);
}

export async function guardarFichero(dir: string, id: string, contenido: Buffer): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(rutaArchivo(dir, id), contenido);
}

/** Borra ficheros en disco con mejor esfuerzo: si falta alguno, no falla. */
export async function eliminarFicheros(dir: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await unlink(rutaArchivo(dir, id));
    } catch {
      // El fichero ya no está: nada que hacer.
    }
  }
}

/** Recuento de adjuntos de varias tareas en una sola consulta agregada. */
export async function adjuntosPorTarea(
  db: Database,
  tareaIds: string[],
): Promise<Map<string, number>> {
  const porTarea = new Map<string, number>();
  if (tareaIds.length === 0) {
    return porTarea;
  }

  const filas = await db
    .select({ tareaId: archivos.tareaId, total: count() })
    .from(archivos)
    .where(inArray(archivos.tareaId, tareaIds))
    .groupBy(archivos.tareaId);

  for (const fila of filas) {
    if (fila.tareaId) {
      porTarea.set(fila.tareaId, fila.total);
    }
  }

  return porTarea;
}

/** Ids de los ficheros adjuntos a una tarea (antes de borrar sus filas). */
export async function recogerArchivosDeTarea(db: Database, tareaId: string): Promise<string[]> {
  const filas = await db
    .select({ id: archivos.id })
    .from(archivos)
    .where(eq(archivos.tareaId, tareaId));

  return filas.map((fila) => fila.id);
}

/** Ids de todos los ficheros de un proyecto: fondos y adjuntos de sus tareas. */
export async function recogerArchivosDeProyecto(
  db: Database,
  proyectoId: string,
): Promise<string[]> {
  const fondos = await db
    .select({ id: archivos.id })
    .from(archivos)
    .where(eq(archivos.proyectoId, proyectoId));

  const adjuntos = await db
    .select({ id: archivos.id })
    .from(archivos)
    .innerJoin(tareas, eq(archivos.tareaId, tareas.id))
    .where(eq(tareas.proyectoId, proyectoId));

  return [...fondos, ...adjuntos].map((fila) => fila.id);
}

/** ¿Es `archivoId` una imagen permitida adjunta a esa tarea del usuario? */
export async function esImagenAdjuntaATarea(
  db: Database,
  archivoId: string,
  tareaId: string,
  usuarioId: string,
): Promise<boolean> {
  const [fila] = await db
    .select({ mime: archivos.mime })
    .from(archivos)
    .where(
      and(
        eq(archivos.id, archivoId),
        eq(archivos.tareaId, tareaId),
        eq(archivos.usuarioId, usuarioId),
      ),
    )
    .limit(1);

  return fila != null && fila.mime !== MIME_OCTET_STREAM;
}

/** ¿Son todos los ids fondos (imágenes del proyecto) del usuario indicado? */
export async function validarFondosDeProyecto(
  db: Database,
  ids: string[],
  proyectoId: string,
  usuarioId: string,
): Promise<boolean> {
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    return false;
  }

  const filas = await db
    .select({ mime: archivos.mime })
    .from(archivos)
    .where(
      and(
        eq(archivos.proyectoId, proyectoId),
        eq(archivos.usuarioId, usuarioId),
        inArray(archivos.id, ids),
      ),
    );

  return filas.length === ids.length && filas.every((fila) => fila.mime !== MIME_OCTET_STREAM);
}
