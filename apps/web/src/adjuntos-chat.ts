/**
 * Archivos de texto adjuntos al chat del asistente: validación, lectura y
 * composición del mensaje que se envía al servidor. Sin dependencias del DOM
 * salvo el propio archivo, para poder probarlo por separado.
 */

import {
  MAX_CARACTERES_CHAT_ASISTENTE,
  MAX_CARACTERES_MENSAJE_ASISTENTE,
  MAX_MENSAJES_CHAT_ASISTENTE,
} from "@todo/shared";

export {
  MAX_CARACTERES_CHAT_ASISTENTE,
  MAX_CARACTERES_MENSAJE_ASISTENTE,
  MAX_MENSAJES_CHAT_ASISTENTE,
};

/** Archivos máximos por mensaje. */
export const MAX_ADJUNTOS = 3;

/** Caracteres máximos de cada archivo; no se trunca: se rechaza. */
export const MAX_CARACTERES_ADJUNTO = 100_000;

export const EXTENSIONES_TEXTO = [
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".log",
  ".ics",
  ".toml",
  ".ini",
  ".sql",
  ".diff",
] as const;

/** Valor del atributo `accept` del selector de archivos. */
export const ACEPTAR_ARCHIVOS = [...EXTENSIONES_TEXTO, "text/*"].join(",");

/** Parte de `File` que necesita la lectura; así se puede probar sin navegador. */
export interface ArchivoTexto {
  name: string;
  type: string;
  size: number;
  text: () => Promise<string>;
}

export interface AdjuntoChat {
  id: string;
  nombre: string;
  tamano: number;
  contenido: string;
  /** El contenido no se conservó (historial guardado sin él). */
  omitido?: boolean;
}

export interface MensajeHistorial {
  rol: "user" | "assistant";
  texto: string;
  adjuntos?: AdjuntoChat[];
}

export interface MensajeParaEnviar {
  rol: "user" | "assistant";
  texto: string;
}

export type MotivoRechazo = "tipo" | "grande" | "binario" | "lectura";

export type ResultadoLectura =
  { ok: true; adjunto: AdjuntoChat } | { ok: false; motivo: MotivoRechazo };

/** El tamaño en bytes no puede superar cuatro veces el límite de caracteres (UTF-8). */
const MAX_BYTES_ADJUNTO = MAX_CARACTERES_ADJUNTO * 4;

export function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function esNombreDeTexto(nombre: string): boolean {
  const punto = nombre.lastIndexOf(".");
  if (punto < 0) return false;
  const extension = nombre.slice(punto).toLowerCase();
  return (EXTENSIONES_TEXTO as readonly string[]).includes(extension);
}

export function esArchivoDeTexto(archivo: { name: string; type: string }): boolean {
  return archivo.type.toLowerCase().startsWith("text/") || esNombreDeTexto(archivo.name);
}

/** Caracteres nulos o una proporción alta de no imprimibles delatan un binario. */
export function esBinario(contenido: string): boolean {
  if (contenido.includes("\u0000")) return true;
  if (contenido.length === 0) return false;
  let noImprimibles = 0;
  for (const caracter of contenido) {
    const codigo = caracter.codePointAt(0) ?? 0;
    const esSalto = codigo === 9 || codigo === 10 || codigo === 12 || codigo === 13;
    if ((codigo < 32 && !esSalto) || codigo === 127) {
      noImprimibles += 1;
    }
  }
  return noImprimibles / contenido.length > 0.1;
}

function nuevoIdAdjunto(): string {
  return `adj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Lee un archivo y lo valida: tipo, tamaño en bytes, binarios y número de caracteres. */
export async function leerAdjunto(archivo: ArchivoTexto): Promise<ResultadoLectura> {
  if (!esArchivoDeTexto(archivo)) {
    return { ok: false, motivo: "tipo" };
  }
  if (archivo.size > MAX_BYTES_ADJUNTO) {
    return { ok: false, motivo: "grande" };
  }

  let contenido: string;
  try {
    contenido = await archivo.text();
  } catch {
    return { ok: false, motivo: "lectura" };
  }

  if (esBinario(contenido)) {
    return { ok: false, motivo: "binario" };
  }
  if (contenido.length > MAX_CARACTERES_ADJUNTO) {
    return { ok: false, motivo: "grande" };
  }

  return {
    ok: true,
    adjunto: {
      id: nuevoIdAdjunto(),
      nombre: archivo.name,
      tamano: archivo.size,
      contenido,
    },
  };
}

function textoOmitido(nombre: string): string {
  return `[Archivo adjunto: ${nombre} — contenido omitido para ahorrar espacio]`;
}

/**
 * Texto que viaja al servidor: primero lo que escribió el usuario y después
 * cada archivo entre delimitadores. Los adjuntos omitidos por el recorte del
 * historial se sustituyen por una marca sin su contenido.
 */
export function componerTextoMensaje(
  texto: string,
  adjuntos: readonly AdjuntoChat[] = [],
  omitidos: ReadonlySet<string> = new Set(),
): string {
  const partes: string[] = [];
  const escrito = texto.trim();
  if (escrito) partes.push(escrito);
  for (const adjunto of adjuntos) {
    if (adjunto.omitido || omitidos.has(adjunto.id)) {
      partes.push(textoOmitido(adjunto.nombre));
    } else {
      partes.push(`[Archivo adjunto: ${adjunto.nombre}]\n${adjunto.contenido}\n[Fin del archivo]`);
    }
  }
  return partes.join("\n\n");
}

/** Caracteres que ocupará el mensaje (texto escrito más adjuntos). */
export function contarCaracteres(texto: string, adjuntos: readonly AdjuntoChat[] = []): number {
  return componerTextoMensaje(texto, adjuntos).length;
}

export interface PeticionCompuesta {
  mensajes: MensajeParaEnviar[];
  total: number;
  /** Ids de los adjuntos cuyo contenido se ha omitido. */
  omitidos: string[];
}

/**
 * Prepara los mensajes de una petición. Si la suma supera el límite, sustituye
 * el contenido de los adjuntos más antiguos por una marca hasta caber; el
 * último mensaje se conserva siempre completo.
 */
export function componerPeticion(
  mensajes: readonly MensajeHistorial[],
  maximo: number = MAX_CARACTERES_CHAT_ASISTENTE,
): PeticionCompuesta {
  const omitidos = new Set<string>();

  const construir = (): MensajeParaEnviar[] =>
    mensajes.map((mensaje) => ({
      rol: mensaje.rol,
      texto:
        mensaje.rol === "user" && mensaje.adjuntos?.length
          ? componerTextoMensaje(mensaje.texto, mensaje.adjuntos, omitidos)
          : mensaje.texto,
    }));

  const sumar = (preparados: MensajeParaEnviar[]): number =>
    preparados.reduce((total, mensaje) => total + mensaje.texto.length, 0);

  let preparados = construir();
  let total = sumar(preparados);
  const ultimo = mensajes.length - 1;

  for (let indice = 0; indice < ultimo && total > maximo; indice += 1) {
    for (const adjunto of mensajes[indice]?.adjuntos ?? []) {
      if (total <= maximo) break;
      if (adjunto.omitido || omitidos.has(adjunto.id)) continue;
      omitidos.add(adjunto.id);
      preparados = construir();
      total = sumar(preparados);
    }
  }

  return { mensajes: preparados, total, omitidos: [...omitidos] };
}
