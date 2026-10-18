import type { CSSProperties } from "react";

import type { PortadaTareaApi } from "./api";

/** Mismas 10 portadas fijas que `PORTADAS_TAREA` de @todo/shared. */
export const COLORES_PORTADA = [
  "#6E4FE6",
  "#C8303A",
  "#2563D9",
  "#18794E",
  "#B4530A",
  "#0E7490",
] as const;

export const PATRONES_PORTADA = [
  "rayas-ambar",
  "cuadros-azul",
  "puntos-rosa",
  "ondas-verde",
] as const;

export type PatronPortada = (typeof PATRONES_PORTADA)[number];

/** Estilo con las variables CSS propias de la portada. */
export type EstiloPortada = CSSProperties & Record<`--${string}`, string>;

/** Tono base de cada patrón: la textura se pinta sobre ese mismo fondo suave. */
const TONO_PATRON: Record<PatronPortada, string> = {
  "rayas-ambar": "#B4530A",
  "cuadros-azul": "#2563D9",
  "puntos-rosa": "#A21CAF",
  "ondas-verde": "#18794E",
};

const SUPERFICIE = "var(--superficie, #ffffff)";
const BRILLO = "var(--portada-brillo, rgba(255, 255, 255, 0.4))";

/** Mezcla el tono con transparencia (o con la superficie del tema). */
function mezcla(tono: string, porcentaje: string, base = "transparent"): string {
  return `color-mix(in srgb, ${tono} ${porcentaje}, ${base})`;
}

/** Fuerza de cada capa, distinta en claro y en oscuro (ver estilos.css). */
const SUAVE = "var(--portada-suave, 16%)";
const FOCO = "var(--portada-foco, 24%)";
const BORDE = "var(--portada-borde, 14%)";
const FONDO = "var(--portada-fondo, 9%)";
const TEXTURA = "var(--portada-textura, 8%)";

interface Variacion {
  angulo: number;
  x: string;
  y: string;
}

/** Variación fija de las portadas guardadas, para que no cambien de una visita a otra. */
const VARIACION_FIJA: Variacion = { angulo: 135, x: "18%", y: "12%" };

const ANGULOS = [115, 130, 145, 160, 200, 215] as const;
const POSICIONES_X = ["16%", "24%", "34%", "66%", "74%"] as const;
const POSICIONES_Y = ["10%", "16%", "24%", "32%"] as const;

/** Texturas sutiles: capas de muy baja opacidad sobre el fondo suave. */
const TEXTURAS: Record<PatronPortada, (tono: string) => string[]> = {
  "rayas-ambar": (tono) => [
    `repeating-linear-gradient(45deg, ${mezcla(tono, TEXTURA)} 0 1px, transparent 1px 8px)`,
  ],
  "cuadros-azul": (tono) => [
    `repeating-linear-gradient(0deg, ${mezcla(tono, `calc(${TEXTURA} * 0.85)`)} 0 1px, transparent 1px 14px)`,
    `repeating-linear-gradient(90deg, ${mezcla(tono, `calc(${TEXTURA} * 0.85)`)} 0 1px, transparent 1px 14px)`,
  ],
  "puntos-rosa": (tono) => [
    `radial-gradient(${mezcla(tono, `calc(${TEXTURA} * 1.8)`)} 1px, transparent 1.6px)`,
  ],
  "ondas-verde": (tono) => [
    `repeating-radial-gradient(circle at 20% 120%, ${mezcla(tono, `calc(${TEXTURA} * 1.2)`)} 0 7px, transparent 7px 17px)`,
  ],
};

/**
 * Fondo suave de la portada: un degradado difuminado del tono base mezclado con
 * la superficie del tema, un velo luminoso en la esquina y, si toca, la textura.
 */
function fondoSuave(tono: string, variacion: Variacion, patron: PatronPortada | null): EstiloPortada {
  const capas = [
    ...(patron ? TEXTURAS[patron](tono) : []),
    `radial-gradient(120% 90% at 85% 0%, ${BRILLO} 0%, transparent 58%)`,
    `radial-gradient(95% 85% at ${variacion.x} ${variacion.y}, ${mezcla(tono, FOCO)} 0%, transparent 62%)`,
    `radial-gradient(110% 100% at 100% 100%, ${mezcla(tono, BORDE)} 0%, transparent 70%)`,
    `linear-gradient(${variacion.angulo}deg, ${mezcla(tono, SUAVE, SUPERFICIE)}, ${mezcla(tono, `calc(${SUAVE} / 3)`, SUPERFICIE)})`,
  ];

  const estilo: EstiloPortada = {
    backgroundColor: mezcla(tono, FONDO, SUPERFICIE),
    backgroundImage: capas.join(", "),
    "--portada-tono": tono,
  };

  // Los puntos se repiten con un tamaño fijo; las demás capas cubren el bloque.
  if (patron === "puntos-rosa") {
    estilo.backgroundSize = capas.map((_, indice) => (indice === 0 ? "14px 14px" : "auto")).join(", ");
  }

  return estilo;
}

/** `true` si el valor guardado es un patrón conocido. */
function esPatron(valor: string): valor is PatronPortada {
  return (PATRONES_PORTADA as readonly string[]).includes(valor);
}

/** Patrón de una portada guardada, o `null` si es un color o una imagen. */
export function patronPortada(portada: PortadaTareaApi | null | undefined): PatronPortada | null {
  if (!portada || portada.tipo !== "color" || !esPatron(portada.valor)) return null;
  return portada.valor;
}

/**
 * Estilo de la portada de una tarea. La portada de imagen se pinta con
 * `background-image` sobre la URL real del archivo; devuelve `null` cuando no
 * hay nada que pintar.
 */
export function estiloPortada(
  portada: PortadaTareaApi | null | undefined,
): EstiloPortada | null {
  if (!portada) return null;

  if (portada.tipo === "imagen") {
    const url = urlArchivo(portada.archivoId);
    return url
      ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }
      : null;
  }

  if (esPatron(portada.valor)) {
    return fondoSuave(TONO_PATRON[portada.valor], VARIACION_FIJA, portada.valor);
  }

  if (portada.valor.startsWith("#")) {
    return fondoSuave(portada.valor, VARIACION_FIJA, null);
  }

  return null;
}

export interface PortadaAutomatica extends Variacion {
  tono: string;
  patron: PatronPortada | null;
}

/** Hash FNV-1a de 32 bits: barato, estable y suficiente para repartir portadas. */
function hash(texto: string): number {
  let valor = 2166136261;
  for (let indice = 0; indice < texto.length; indice += 1) {
    valor ^= texto.charCodeAt(indice);
    valor = Math.imul(valor, 16777619);
  }
  return valor >>> 0;
}

/**
 * Portada automática de una tarea sin portada: elige tono o patrón y una
 * variación (ángulo y posición del degradado) a partir de su id, de modo que
 * cada tarea luzca distinta pero siempre igual para el mismo id.
 */
export function portadaAutomatica(tareaId: string): PortadaAutomatica {
  const base = hash(tareaId);
  const variacion = hash(`variacion:${tareaId}`);
  const opciones: readonly string[] = [...COLORES_PORTADA, ...PATRONES_PORTADA];
  const elegida = opciones[base % opciones.length] ?? COLORES_PORTADA[0];
  const patron = esPatron(elegida) ? elegida : null;

  return {
    tono: patron ? TONO_PATRON[patron] : elegida,
    patron,
    angulo: ANGULOS[variacion % ANGULOS.length] ?? VARIACION_FIJA.angulo,
    x: POSICIONES_X[(variacion >>> 3) % POSICIONES_X.length] ?? VARIACION_FIJA.x,
    y: POSICIONES_Y[(variacion >>> 6) % POSICIONES_Y.length] ?? VARIACION_FIJA.y,
  };
}

/** Estilo de la portada automática de una tarea. */
export function estiloPortadaAutomatica(tareaId: string): EstiloPortada {
  const { tono, patron, ...variacion } = portadaAutomatica(tareaId);
  return fondoSuave(tono, variacion, patron);
}

export interface DatosPortadaTarjeta {
  /** URL de la imagen adjunta, o `null` si la portada es suave. */
  imagen: string | null;
  /** Fondo suave; vacío cuando la portada es una imagen. */
  estilo: EstiloPortada;
  /** `true` si no hay portada guardada y se usa la automática. */
  automatica: boolean;
  patron: PatronPortada | null;
}

/**
 * Todo lo que necesita una tarjeta del tablero para pintar su portada. Las
 * portadas ausentes o inválidas se resuelven con la automática del id.
 */
export function datosPortadaTarjeta(
  tareaId: string,
  portada: PortadaTareaApi | null | undefined,
): DatosPortadaTarjeta {
  const imagen = portada?.tipo === "imagen" ? urlArchivo(portada.archivoId) : null;
  if (imagen) return { imagen, estilo: {}, automatica: false, patron: null };

  const guardada = estiloPortada(portada);
  if (guardada) {
    return { imagen: null, estilo: guardada, automatica: false, patron: patronPortada(portada) };
  }

  const automatica = portadaAutomatica(tareaId);
  return {
    imagen: null,
    estilo: fondoSuave(automatica.tono, automatica, automatica.patron),
    automatica: true,
    patron: automatica.patron,
  };
}

/** El id de archivo de la API es un uuid: no se construye la URL con otra cosa. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL para servir un archivo, o `null` si el id no es un uuid válido. */
export function urlArchivo(archivoId: string): string | null {
  return UUID.test(archivoId) ? `/api/archivos/${archivoId}` : null;
}

/** `true` si la portada es una imagen adjunta con un id válido. */
export function esPortadaImagen(portada: PortadaTareaApi | null | undefined): boolean {
  return Boolean(portada?.tipo === "imagen" && urlArchivo(portada.archivoId));
}
