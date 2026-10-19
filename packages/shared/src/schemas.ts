import { z } from "zod";

import { esquemaRecurrencia, esquemaZona } from "./recurrencia.js";

const esquemaVenceEn = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional()
  .transform((valor) => (valor == null ? valor : new Date(valor)));

const esquemaRecordatorioMin = z
  .number()
  .int("El recordatorio debe ser un número entero de minutos")
  .min(0, "El recordatorio no puede ser negativo")
  .max(10080, "El recordatorio no puede superar los 7 días")
  .nullable();

export const esquemaRegistro = z.object({
  email: z.string().trim().toLowerCase().email("Correo electrónico no válido"),
  nombre: z.string().trim().min(1, "Nombre obligatorio").max(100, "Nombre demasiado largo"),
  contrasena: z
    .string()
    .min(10, "La contraseña debe tener al menos 10 caracteres")
    .max(128, "La contraseña es demasiado larga"),
});

export const esquemaLogin = z.object({
  email: z.string().trim().toLowerCase().email("Correo electrónico no válido"),
  contrasena: z.string().min(1, "Contraseña obligatoria").max(128, "Contraseña demasiado larga"),
});

export const esquemaPin = z.object({
  pin: z.string().regex(/^\d{6,12}$/, "El PIN debe tener de 6 a 12 dígitos"),
});

export type DatosRegistro = z.infer<typeof esquemaRegistro>;
export type DatosLogin = z.infer<typeof esquemaLogin>;

const esquemaColorHex = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "El color debe tener el formato #rrggbb");

export const AMBIENTES_FONDO = ["bosque", "noche", "coral", "pizarra", "ciruela"] as const;

export const esquemaFondoProyecto = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("ambiente"),
    ambiente: z.enum(AMBIENTES_FONDO, { message: "Ambiente no válido" }),
  }),
  z.object({
    tipo: z.literal("color"),
    color: esquemaColorHex,
  }),
  z.object({
    tipo: z.literal("imagenes"),
    ids: z
      .array(z.string().uuid("Archivo no válido"))
      .min(1, "Hace falta al menos una imagen")
      .max(10, "Como máximo 10 imágenes"),
    intervaloSeg: z
      .number()
      .int("El intervalo debe ser un número entero de segundos")
      .min(10, "El intervalo mínimo es de 10 segundos")
      .max(600, "El intervalo máximo es de 600 segundos")
      .default(30),
  }),
]);

export type AmbienteFondo = (typeof AMBIENTES_FONDO)[number];
export type FondoProyecto = z.infer<typeof esquemaFondoProyecto>;

export const esquemaProyecto = z.object({
  nombre: z.string().trim().min(1, "Nombre obligatorio").max(200, "Nombre demasiado largo"),
  descripcion: z.string().max(5000, "Descripción demasiado larga").optional(),
});

export const esquemaProyectoParcial = esquemaProyecto.partial().extend({
  color: esquemaColorHex.nullable().optional(),
  fondo: esquemaFondoProyecto.optional(),
});

/** Portadas fijas de tarea: 6 colores sólidos hex y 4 patrones con nombre. */
export const PORTADAS_TAREA = [
  "#6E4FE6",
  "#C8303A",
  "#2563D9",
  "#18794E",
  "#B4530A",
  "#0E7490",
  "rayas-ambar",
  "cuadros-azul",
  "puntos-rosa",
  "ondas-verde",
] as const;

export type ValorPortada = (typeof PORTADAS_TAREA)[number];

export const esquemaPortada = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("color"),
    valor: z.enum(PORTADAS_TAREA, { message: "Portada no válida" }),
  }),
  z.object({
    tipo: z.literal("imagen"),
    archivoId: z.string().uuid("Archivo no válido"),
  }),
]);

export type Portada = z.infer<typeof esquemaPortada>;

export const esquemaTareaBase = z.object({
  titulo: z.string().trim().min(1, "Título obligatorio").max(300, "Título demasiado largo"),
  descripcion: z.string().max(5000, "Descripción demasiado larga").optional(),
  columnaId: z.string().uuid("Columna no válida").optional(),
  venceEn: esquemaVenceEn,
  recurrencia: esquemaRecurrencia.nullable().optional(),
  zona: esquemaZona.optional(),
  recordatorioMin: esquemaRecordatorioMin.optional(),
});

export const esquemaTarea = esquemaTareaBase.refine(
  (datos) => datos.recurrencia == null || datos.venceEn != null,
  { message: "Una tarea recurrente necesita fecha", path: ["venceEn"] },
);

export const esquemaTareaParcial = esquemaTareaBase
  .extend({
    posicion: z.number().int().min(0, "Posición no válida").optional(),
    portada: esquemaPortada.nullable().optional(),
  })
  .partial();

export const esquemaMoverTarea = z.object({
  proyectoId: z.string().uuid("Proyecto no válido"),
  columnaId: z.string().uuid("Columna no válida"),
});

/**
 * Excepción de una sola ocurrencia de una serie recurrente: moverla, omitirla
 * o cambiarle el título. `fechaOriginal` es la clave (la fecha de la serie).
 */
export const esquemaExcepcionOcurrencia = z
  .object({
    fechaOriginal: z.string().datetime({ offset: true }),
    fechaNueva: z.string().datetime({ offset: true }).optional(),
    omitida: z.boolean().optional(),
    titulo: z
      .string()
      .trim()
      .min(1, "Título obligatorio")
      .max(300, "Título demasiado largo")
      .optional(),
  })
  .refine(
    (datos) =>
      datos.fechaNueva !== undefined || datos.omitida === true || datos.titulo !== undefined,
    { message: "Hace falta mover, omitir o renombrar la ocurrencia" },
  )
  .refine(
    (datos) =>
      !(datos.omitida === true && (datos.fechaNueva !== undefined || datos.titulo !== undefined)),
    { message: "Una ocurrencia omitida no puede moverse ni renombrarse" },
  );

export type DatosExcepcionOcurrencia = z.infer<typeof esquemaExcepcionOcurrencia>;

/** Paleta fija de etiquetas (texto blanco, contraste ≥ 4.5:1). */
export const COLORES_ETIQUETA = [
  "#6E4FE6",
  "#C8303A",
  "#2563D9",
  "#18794E",
  "#B4530A",
  "#0E7490",
  "#A21CAF",
  "#4B5563",
] as const;

export type ColorEtiqueta = (typeof COLORES_ETIQUETA)[number];

export const esquemaEtiqueta = z.object({
  nombre: z.string().trim().min(1, "Nombre obligatorio").max(40, "Nombre demasiado largo"),
  color: z.enum(COLORES_ETIQUETA, { message: "Color no válido" }),
});

export const esquemaEtiquetaParcial = esquemaEtiqueta.partial();

export const esquemaEtiquetasTarea = z.object({
  ids: z.array(z.string().uuid("Etiqueta no válida")),
});

export const esquemaChecklistItem = z.object({
  texto: z.string().trim().min(1, "Texto obligatorio").max(300, "Texto demasiado largo"),
});

export const esquemaChecklistItemParcial = z.object({
  texto: z.string().trim().min(1, "Texto obligatorio").max(300, "Texto demasiado largo").optional(),
  hecho: z.boolean().optional(),
  posicion: z.number().int().min(0, "Posición no válida").optional(),
});

export const esquemaComentario = z.object({
  texto: z.string().trim().min(1, "Texto obligatorio").max(5000, "Texto demasiado largo"),
});

export const esquemaComentarioParcial = z.object({
  texto: z
    .string()
    .trim()
    .min(1, "Texto obligatorio")
    .max(5000, "Texto demasiado largo")
    .optional(),
});

export const PERMISOS_TOKEN = ["lectura", "escritura", "calendario"] as const;

export const esquemaTokenApi = z.object({
  nombre: z.string().trim().min(1, "Nombre obligatorio").max(100, "Nombre demasiado largo"),
  permiso: z.enum(["lectura", "escritura", "calendario"]),
  expiraEn: z
    .union([z.string().datetime({ offset: true }), z.null()])
    .optional()
    .transform((valor) => (valor == null ? valor : new Date(valor))),
});

export type PermisoToken = (typeof PERMISOS_TOKEN)[number];
export type DatosTokenApi = z.infer<typeof esquemaTokenApi>;

export const esquemaColumna = z.object({
  nombre: z.string().trim().min(1, "Nombre obligatorio").max(100, "Nombre demasiado largo"),
});

export const esquemaColumnaParcial = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "Nombre obligatorio")
    .max(100, "Nombre demasiado largo")
    .optional(),
  posicion: z.number().int().min(0, "Posición no válida").optional(),
});

export const PRESETS_ASISTENTE = [
  "deepseek",
  "openai",
  "opencode-go",
  "personalizado",
] as const;
export type PresetAsistente = (typeof PRESETS_ASISTENTE)[number];

export interface DefectosPresetAsistente {
  baseUrl: string;
  modelo: string;
  razonamiento: string | null;
}

/** Valores de cada preset; `personalizado` deja base URL y modelo libres. */
export const PRESETS_ASISTENTE_DEFECTOS: Record<PresetAsistente, DefectosPresetAsistente | null> = {
  deepseek: { baseUrl: "https://api.deepseek.com", modelo: "deepseek-flash", razonamiento: null },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    modelo: "gpt-6-luna",
    razonamiento: "none",
  },
  "opencode-go": {
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    modelo: "deepseek-v4.1-flash",
    razonamiento: null,
  },
  personalizado: null,
};

export const RAZONAMIENTOS_ASISTENTE = ["none", "low", "medium", "high"] as const;
export type RazonamientoAsistente = (typeof RAZONAMIENTOS_ASISTENTE)[number];

/** HTTPS siempre; HTTP solo para un proveedor local (pruebas). */
export function esBaseUrlAsistentePermitida(valor: string): boolean {
  const coincidencia = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(valor);
  if (!coincidencia) {
    return false;
  }
  const protocolo = coincidencia[1]!.toLowerCase();
  if (protocolo === "https") {
    return true;
  }
  if (protocolo !== "http") {
    return false;
  }
  const autoridad = coincidencia[2]!.split("@").pop() ?? "";
  const host = autoridad.startsWith("[")
    ? autoridad.slice(0, autoridad.indexOf("]") + 1)
    : (autoridad.split(":")[0] ?? "");
  return ["localhost", "127.0.0.1", "[::1]"].includes(host.toLowerCase());
}

const esquemaBaseUrlAsistente = z
  .string()
  .trim()
  .url("La URL del proveedor no es válida")
  .refine(esBaseUrlAsistentePermitida, "La URL del proveedor debe usar https://");

const esquemaRazonamientoAsistente = z
  .enum(RAZONAMIENTOS_ASISTENTE, { message: "Nivel de razonamiento no válido" })
  .nullable();

export const esquemaConfigAsistente = z.object({
  preset: z.enum(PRESETS_ASISTENTE, { message: "Proveedor no válido" }),
  baseUrl: esquemaBaseUrlAsistente.optional(),
  modelo: z
    .string()
    .trim()
    .min(1, "Modelo obligatorio")
    .max(200, "Nombre de modelo demasiado largo")
    .optional(),
  razonamiento: esquemaRazonamientoAsistente.optional(),
  clave: z
    .string()
    .trim()
    .min(1, "Clave obligatoria")
    .max(500, "La clave es demasiado larga")
    .optional(),
});

export type DatosConfigAsistente = z.infer<typeof esquemaConfigAsistente>;

/** Prueba del proveedor: cualquier campo es opcional y se completa con lo guardado. */
export const esquemaPruebaAsistente = esquemaConfigAsistente.partial();

export type DatosPruebaAsistente = z.infer<typeof esquemaPruebaAsistente>;

/** Mensaje del chat del asistente: el cliente envía el historial acotado en cada petición. */
export const esquemaMensajeAsistente = z.object({
  rol: z.enum(["user", "assistant"], { message: "Rol de mensaje no válido" }),
  texto: z
    .string()
    .trim()
    .min(1, "El mensaje no puede estar vacío")
    .max(4000, "El mensaje es demasiado largo"),
});

export const esquemaChatAsistente = z.object({
  mensajes: z
    .array(esquemaMensajeAsistente)
    .min(1, "Hace falta al menos un mensaje")
    .max(20, "El historial no puede superar los 20 mensajes"),
  conversacionId: z.string().uuid("Conversación no válida").optional(),
  zona: esquemaZona.optional(),
});

export type DatosMensajeAsistente = z.infer<typeof esquemaMensajeAsistente>;
export type DatosChatAsistente = z.infer<typeof esquemaChatAsistente>;
