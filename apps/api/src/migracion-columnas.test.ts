import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("migración de columnas", () => {
  let client: PGlite;

  beforeAll(async () => {
    client = new PGlite();
    const dir = fileURLToPath(new URL("../drizzle", import.meta.url));

    const ejecutarArchivo = async (archivo: string) => {
      const sqlTexto = readFileSync(`${dir}/${archivo}`, "utf8");
      const statements = sqlTexto
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await client.query(statement);
      }
    };

    await ejecutarArchivo("0000_charming_obadiah_stane.sql");
    await ejecutarArchivo("0001_aromatic_zarda.sql");

    const usuario = (await client.query(
      "INSERT INTO usuarios (email, nombre, password_hash) VALUES ('mig@example.com', 'Migración', 'hash') RETURNING id",
    )) as { rows: Array<{ id: string }> };
    const usuarioId = usuario.rows[0]!.id;

    const proyecto = (await client.query(
      `INSERT INTO proyectos (nombre, propietario_id) VALUES ('Proyecto migración', '${usuarioId}') RETURNING id`,
    )) as { rows: Array<{ id: string }> };
    const proyectoId = proyecto.rows[0]!.id;

    await client.query(
      `INSERT INTO tareas (proyecto_id, titulo, estado, created_at) VALUES ('${proyectoId}', 'Tarea pendiente', 'pendiente', '2026-01-01T00:00:00Z'::timestamptz)`,
    );
    await client.query(
      `INSERT INTO tareas (proyecto_id, titulo, estado, created_at) VALUES ('${proyectoId}', 'Tarea en curso', 'en_curso', '2026-01-01T00:00:01Z'::timestamptz)`,
    );
    await client.query(
      `INSERT INTO tareas (proyecto_id, titulo, estado, created_at) VALUES ('${proyectoId}', 'Tarea hecha', 'hecha', '2026-01-01T00:00:02Z'::timestamptz)`,
    );

    await ejecutarArchivo("0002_columnas_y_posiciones.sql");
  });

  it("mapea el estado antiguo a columnas y posiciones", async () => {
    const columnas = (await client.query(
      "SELECT nombre, posicion FROM columnas ORDER BY posicion",
    )) as { rows: Array<{ nombre: string; posicion: number }> };
    expect(columnas.rows.map((r) => r.nombre)).toEqual(["Pendiente", "En curso", "Hecha"]);

    const tareas = (await client.query(
      `SELECT t.titulo, c.nombre AS columna, t.posicion
       FROM tareas t JOIN columnas c ON c.id = t.columna_id
       ORDER BY t.created_at`,
    )) as { rows: Array<{ titulo: string; columna: string; posicion: number }> };

    expect(tareas.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titulo: "Tarea pendiente", columna: "Pendiente", posicion: 0 }),
        expect.objectContaining({ titulo: "Tarea en curso", columna: "En curso", posicion: 0 }),
        expect.objectContaining({ titulo: "Tarea hecha", columna: "Hecha", posicion: 0 }),
      ]),
    );
  });
});
