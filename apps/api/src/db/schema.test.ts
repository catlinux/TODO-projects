import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";

import { buildApp } from "../app.js";
import type { Database } from "./index.js";
import * as schema from "./schema.js";

type Usuario = typeof schema.usuarios.$inferSelect;
type Proyecto = typeof schema.proyectos.$inferSelect;
type Tarea = typeof schema.tareas.$inferSelect;
type Columna = typeof schema.columnas.$inferSelect;

describe("esquema de base de datos", () => {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  it("aplica las migraciones y crea las tablas", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = result.rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining(["usuarios", "proyectos", "tareas", "columnas"]));
  });

  it("inserta usuarios, proyectos y tareas con sus relaciones", async () => {
    const [usuario] = (await db
      .insert(schema.usuarios)
      .values({ email: "ana@example.com", nombre: "Ana", passwordHash: "hash" })
      .returning()) as [Usuario];
    const [proyecto] = (await db
      .insert(schema.proyectos)
      .values({ nombre: "Proyecto", propietarioId: usuario.id })
      .returning()) as [Proyecto];
    const [columna] = (await db
      .insert(schema.columnas)
      .values({ proyectoId: proyecto.id, nombre: "Pendiente", posicion: 0 })
      .returning()) as [Columna];
    const [tarea] = (await db
      .insert(schema.tareas)
      .values({ proyectoId: proyecto.id, columnaId: columna.id, titulo: "Tarea", posicion: 0 })
      .returning()) as [Tarea];

    expect(proyecto.propietarioId).toBe(usuario.id);
    expect(tarea.proyectoId).toBe(proyecto.id);
    expect(tarea.columnaId).toBe(columna.id);
    expect(usuario.createdAt).toBeInstanceOf(Date);
    expect(usuario.updatedAt).toBeInstanceOf(Date);
  });

  it("borra las tareas en cascada al borrar el proyecto", async () => {
    const [usuario] = (await db
      .insert(schema.usuarios)
      .values({ email: "borrado@example.com", nombre: "Borrado", passwordHash: "hash" })
      .returning()) as [Usuario];
    const [proyecto] = (await db
      .insert(schema.proyectos)
      .values({ nombre: "Borrar", propietarioId: usuario.id })
      .returning()) as [Proyecto];
    const [columna] = (await db
      .insert(schema.columnas)
      .values({ proyectoId: proyecto.id, nombre: "Pendiente", posicion: 0 })
      .returning()) as [Columna];
    await db.insert(schema.tareas).values({
      proyectoId: proyecto.id,
      columnaId: columna.id,
      titulo: "Se va",
      posicion: 0,
    });

    await db.delete(schema.proyectos).where(eq(schema.proyectos.id, proyecto.id));
    const restantes = await db
      .select()
      .from(schema.tareas)
      .where(eq(schema.tareas.proyectoId, proyecto.id));

    expect(restantes).toHaveLength(0);
  });

  it("actualiza updated_at", async () => {
    const [usuario] = (await db
      .insert(schema.usuarios)
      .values({ email: "fecha@example.com", nombre: "Fecha", passwordHash: "hash" })
      .returning()) as [Usuario];
    const ahora = new Date(Date.now() + 1000);
    await db
      .update(schema.usuarios)
      .set({ nombre: "Fecha nueva", updatedAt: ahora })
      .where(eq(schema.usuarios.id, usuario.id));

    const [actualizado] = (await db
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.id, usuario.id))) as [Usuario];

    expect(actualizado.updatedAt.getTime()).toBe(ahora.getTime());
  });

  it("GET /salud responde 200", async () => {
    const app = await buildApp(db as unknown as Database);
    const respuesta = await app.inject({ method: "GET", url: "/salud" });
    await app.close();

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ estado: "ok" });
  });
});
