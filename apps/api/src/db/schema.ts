import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const proyectos = pgTable("proyectos", {
  id: uuid("id").primaryKey().defaultRandom(),
  nombre: text("nombre").notNull(),
  descripcion: text("descripcion"),
  propietarioId: uuid("propietario_id")
    .notNull()
    .references(() => usuarios.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const columnas = pgTable("columnas", {
  id: uuid("id").primaryKey().defaultRandom(),
  proyectoId: uuid("proyecto_id")
    .notNull()
    .references(() => proyectos.id, { onDelete: "cascade" }),
  nombre: text("nombre").notNull(),
  posicion: integer("posicion").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const tareas = pgTable("tareas", {
  id: uuid("id").primaryKey().defaultRandom(),
  proyectoId: uuid("proyecto_id")
    .notNull()
    .references(() => proyectos.id, { onDelete: "cascade" }),
  columnaId: uuid("columna_id")
    .notNull()
    .references(() => columnas.id, { onDelete: "restrict" }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  posicion: integer("posicion").notNull(),
  venceEn: timestamp("vence_en", { withTimezone: true }),
  recurrencia: text("recurrencia"),
  zona: text("zona").notNull().default("Europe/Madrid"),
  recordatorioMin: integer("recordatorio_min"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sesiones = pgTable("sesiones", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiraEn: timestamp("expira_en", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const avisosEnviados = pgTable(
  "avisos_enviados",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tareaId: uuid("tarea_id")
      .notNull()
      .references(() => tareas.id, { onDelete: "cascade" }),
    ocurrencia: timestamp("ocurrencia", { withTimezone: true }).notNull(),
    canal: text("canal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (tabla) => [
    uniqueIndex("avisos_enviados_tarea_ocurrencia_canal_idx").on(
      tabla.tareaId,
      tabla.ocurrencia,
      tabla.canal,
    ),
  ],
);

export const suscripcionesPush = pgTable("suscripciones_push", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const ocurrenciasHechas = pgTable(
  "ocurrencias_hechas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tareaId: uuid("tarea_id")
      .notNull()
      .references(() => tareas.id, { onDelete: "cascade" }),
    ocurrencia: timestamp("ocurrencia", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (tabla) => [
    uniqueIndex("ocurrencias_hechas_tarea_ocurrencia_idx").on(tabla.tareaId, tabla.ocurrencia),
  ],
);

export const tokensApi = pgTable("tokens_api", {
  id: uuid("id").primaryKey().defaultRandom(),
  usuarioId: uuid("usuario_id")
    .notNull()
    .references(() => usuarios.id, { onDelete: "cascade" }),
  nombre: text("nombre").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefijo: text("prefijo").notNull(),
  permiso: text("permiso").notNull(),
  ultimoUso: timestamp("ultimo_uso", { withTimezone: true }),
  expiraEn: timestamp("expira_en", { withTimezone: true }),
  revocadoEn: timestamp("revocado_en", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
