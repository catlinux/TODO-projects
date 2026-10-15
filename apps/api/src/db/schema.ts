import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
