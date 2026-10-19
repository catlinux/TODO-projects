export interface OpcionesReducirImagen {
  /** Lado mayor máximo, en píxeles. */
  ladoMax: number;
  /** Calidad de la salida con pérdida (0 a 1). */
  calidad: number;
  /** Peso a partir del cual se recodifica aunque quepa en píxeles (fotos muy pesadas). */
  bytesMax?: number;
}

/** Suficiente para un fondo a pantalla completa: 1920 px y webp al 80 %. */
export const OPCIONES_BIBLIOTECA: OpcionesReducirImagen = {
  ladoMax: 1920,
  calidad: 0.8,
  bytesMax: 1_500_000,
};

const OPCIONES_POR_DEFECTO: OpcionesReducirImagen = OPCIONES_BIBLIOTECA;

/** Los gif se dejan intactos: reducirlos perdería la animación. */
const TIPOS_REDUCIBLES = new Set(["image/png", "image/jpeg", "image/webp"]);

interface FuenteImagen {
  ancho: number;
  alto: number;
  dibujar: (contexto: CanvasRenderingContext2D, ancho: number, alto: number) => void;
  liberar: () => void;
}

/**
 * Carga la imagen para dibujarla en el lienzo. `createImageBitmap` es más
 * rápido y no necesita URL temporal; el elemento `Image` es el respaldo.
 */
async function cargarFuente(archivo: File): Promise<FuenteImagen> {
  if (typeof createImageBitmap === "function") {
    const mapa = await createImageBitmap(archivo);
    return {
      ancho: mapa.width,
      alto: mapa.height,
      dibujar: (contexto, ancho, alto) => contexto.drawImage(mapa, 0, 0, ancho, alto),
      liberar: () => mapa.close(),
    };
  }

  const url = URL.createObjectURL(archivo);
  try {
    const imagen = new Image();
    await new Promise<void>((resolver, rechazar) => {
      imagen.onload = () => resolver();
      imagen.onerror = () => rechazar(new Error("No se pudo leer la imagen"));
      imagen.src = url;
    });
    return {
      ancho: imagen.naturalWidth,
      alto: imagen.naturalHeight,
      dibujar: (contexto, ancho, alto) => contexto.drawImage(imagen, 0, 0, ancho, alto),
      liberar: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** El navegador codifica webp si el lienzo lo soporta. */
function soportaWebp(lienzo: HTMLCanvasElement): boolean {
  try {
    return lienzo.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

function exportar(
  lienzo: HTMLCanvasElement,
  tipo: string,
  calidad: number,
): Promise<Blob | null> {
  return new Promise((resolver) => lienzo.toBlob(resolver, tipo, calidad));
}

/** Cambia la extensión del nombre por la del formato de salida. */
function conExtension(nombre: string, tipo: string): string {
  const extension = tipo === "image/webp" ? "webp" : "jpg";
  const punto = nombre.lastIndexOf(".");
  const base = punto > 0 ? nombre.slice(0, punto) : nombre;
  return `${base}.${extension}`;
}

/**
 * Reduce en el navegador las imágenes png/jpeg/webp cuyo lado mayor supere
 * `ladoMax` (o que pesen más de `bytesMax`), conservando la proporción. Los gif
 * y las imágenes que ya son ligeras se devuelven tal cual. Si algo falla, también se devuelve el original: es mejor
 * subir una imagen grande que perderla.
 */
export async function reducirImagen(
  archivo: File,
  opciones: OpcionesReducirImagen = OPCIONES_POR_DEFECTO,
): Promise<File> {
  if (!TIPOS_REDUCIBLES.has(archivo.type)) return archivo;

  const ladoMax = Math.max(1, Math.trunc(opciones.ladoMax));
  const calidad = Math.min(1, Math.max(0, opciones.calidad));

  let fuente: FuenteImagen | null = null;
  try {
    fuente = await cargarFuente(archivo);
    const ladoMayor = Math.max(fuente.ancho, fuente.alto);
    const cabeEnPixeles = ladoMayor <= ladoMax;
    if (cabeEnPixeles && archivo.size <= (opciones.bytesMax ?? Infinity)) return archivo;

    const escala = Math.min(1, ladoMax / ladoMayor);
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.max(1, Math.round(fuente.ancho * escala));
    lienzo.height = Math.max(1, Math.round(fuente.alto * escala));

    const contexto = lienzo.getContext("2d");
    if (!contexto) return archivo;

    fuente.dibujar(contexto, lienzo.width, lienzo.height);
    const tipoSalida = soportaWebp(lienzo) ? "image/webp" : "image/jpeg";
    const reducida = await exportar(lienzo, tipoSalida, calidad);
    if (!reducida) return archivo;
    // Sin cambio de tamaño en píxeles, solo vale la pena si pesa menos que el original.
    if (cabeEnPixeles && reducida.size >= archivo.size) return archivo;

    return new File([reducida], conExtension(archivo.name, tipoSalida), {
      type: tipoSalida,
      lastModified: archivo.lastModified,
    });
  } catch {
    return archivo;
  } finally {
    fuente?.liberar();
  }
}
