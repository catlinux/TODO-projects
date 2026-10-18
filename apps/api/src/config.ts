export interface ConfigArchivos {
  /** Directorio donde se guardan los ficheros (nombre = id, sin extensión). */
  dir: string;
  /** Tamaño máximo por archivo, en bytes. */
  maxBytes: number;
}

export const ARCHIVOS_DIR_POR_DEFECTO = "/data/archivos";
export const ARCHIVOS_MAX_MB_POR_DEFECTO = 10;

/** Lee la configuración de archivos del entorno (ARCHIVOS_DIR y ARCHIVOS_MAX_MB). */
export function leerConfigArchivos(entorno: NodeJS.ProcessEnv = process.env): ConfigArchivos {
  const dir = entorno.ARCHIVOS_DIR?.trim() || ARCHIVOS_DIR_POR_DEFECTO;

  const maxMb = Number(entorno.ARCHIVOS_MAX_MB ?? ARCHIVOS_MAX_MB_POR_DEFECTO);
  const maxMbValido = Number.isFinite(maxMb) && maxMb > 0 ? maxMb : ARCHIVOS_MAX_MB_POR_DEFECTO;

  return { dir, maxBytes: Math.floor(maxMbValido * 1024 * 1024) };
}
