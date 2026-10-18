import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
const VERSION = "v1";
const BYTES_CLAVE = 32;
const BYTES_IV = 12;

/**
 * Lee `ASISTENTE_CLAVE_CIFRADO` (32 bytes en base64). Devuelve null si falta
 * o no tiene la longitud esperada; en ese caso el asistente queda desactivado.
 */
export function leerClaveCifrado(entorno: NodeJS.ProcessEnv = process.env): Buffer | null {
  const bruto = entorno.ASISTENTE_CLAVE_CIFRADO?.trim();
  if (!bruto) {
    return null;
  }
  const clave = Buffer.from(bruto, "base64");
  return clave.length === BYTES_CLAVE ? clave : null;
}

/** Cifra un texto con AES-256-GCM y lo serializa como `v1.iv.tag.datos` (base64). */
export function cifrarClave(texto: string, clave: Buffer): string {
  const iv = randomBytes(BYTES_IV);
  const cifrador = createCipheriv(ALGORITMO, clave, iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  return [
    VERSION,
    iv.toString("base64"),
    cifrador.getAuthTag().toString("base64"),
    datos.toString("base64"),
  ].join(".");
}

/** Descifra un valor guardado; null si el formato no vale o la clave no es la correcta. */
export function descifrarClave(guardada: string, clave: Buffer): string | null {
  const partes = guardada.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) {
    return null;
  }
  const [, ivBase64, tagBase64, datosBase64] = partes;
  if (!ivBase64 || !tagBase64 || !datosBase64) {
    return null;
  }
  try {
    const descifrador = createDecipheriv(ALGORITMO, clave, Buffer.from(ivBase64, "base64"));
    descifrador.setAuthTag(Buffer.from(tagBase64, "base64"));
    const datos = Buffer.concat([
      descifrador.update(Buffer.from(datosBase64, "base64")),
      descifrador.final(),
    ]);
    return datos.toString("utf8");
  } catch {
    return null;
  }
}
