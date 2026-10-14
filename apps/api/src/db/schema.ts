import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const usuarios = pgTable("usuarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  nombre: text("nombre").notNull(),
  passwordHash: text("password_hash"),
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

export const tareas = pgTable("tareas", {
  id: uuid("id").primaryKey().defaultRandom(),
  proyectoId: uuid("proyecto_id")
    .notNull()
    .references(() => proyectos.id, { onDelete: "cascade" }),
  titulo: text("titulo").notNull(),
  descripcion: text("descripcion"),
  estado: text("estado").notNull().default("pendiente"),
  venceEn: timestamp("vence_en", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
