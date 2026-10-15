import { z } from "zod";

import { esquemaRecurrencia, esquemaZona } from "./recurrencia.js";

const esquemaVenceEn = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .optional()
  .transform((valor) => (valor == null ? valor : new Date(valor)));

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

export type DatosRegistro = z.infer<typeof esquemaRegistro>;
export type DatosLogin = z.infer<typeof esquemaLogin>;

export const esquemaProyecto = z.object({
  nombre: z.string().trim().min(1, "Nombre obligatorio").max(200, "Nombre demasiado largo"),
  descripcion: z.string().max(5000, "Descripción demasiado larga").optional(),
});

export const esquemaProyectoParcial = esquemaProyecto.partial();

export const esquemaTareaBase = z.object({
  titulo: z.string().trim().min(1, "Título obligatorio").max(300, "Título demasiado largo"),
  descripcion: z.string().max(5000, "Descripción demasiado larga").optional(),
  columnaId: z.string().uuid("Columna no válida").optional(),
  venceEn: esquemaVenceEn,
  recurrencia: esquemaRecurrencia.nullable().optional(),
  zona: esquemaZona.optional(),
});

export const esquemaTarea = esquemaTareaBase.refine(
  (datos) => datos.recurrencia == null || datos.venceEn != null,
  { message: "Una tarea recurrente necesita fecha", path: ["venceEn"] },
);

export const esquemaTareaParcial = esquemaTareaBase
  .extend({
    posicion: z.number().int().min(0, "Posición no válida").optional(),
  })
  .partial();

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
