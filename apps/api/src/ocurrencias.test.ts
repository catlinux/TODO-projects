import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import { ocurrenciasHechas } from "./db/schema.js";
import type { Canal } from "./avisos/canal.js";
import { procesarAvisos } from "./avisos/procesar.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

class CanalFalso implements Canal {
  enviados: string[] = [];
  readonly id = "correo" as const;
  async enviar(_destino: unknown, aviso: { cuerpo: string }): Promise<void> {
    this.enviados.push(aviso.cuerpo);
  }
}

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("ocurrencias hechas", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    app = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table ocurrencias_hechas, avisos_enviados, suscripciones_push, tareas, columnas, proyectos, usuarios restart identity cascade`,
    );
  });

  async function registrar(sufijo: string) {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `ocurrencias-${sufijo}@example.com`,
        nombre: sufijo,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  async function crearTarea(
    cookie: string,
    datos: { titulo: string; venceEn: string; recurrencia?: string | null },
  ) {
    const proyectoRespuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: `Proyecto ${datos.titulo}` },
    });
    const proyecto = proyectoRespuesta.json() as { id: string };
    const columnasRespuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const columnas = columnasRespuesta.json() as Array<{ id: string }>;
    const tareaRespuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: {
        titulo: datos.titulo,
        columnaId: columnas[0]!.id,
        venceEn: datos.venceEn,
        recurrencia: datos.recurrencia ?? null,
        recordatorioMin: 0,
      },
    });
    return tareaRespuesta.json() as { id: string };
  }

  it("exige sesión", async () => {
    const respuesta = await app.inject({
      method: "POST",
      url: "/tareas/00000000-0000-0000-0000-000000000000/ocurrencias",
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: true },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it("marca y desmarca una ocurrencia, y la agenda lo refleja", async () => {
    const cookie = await registrar("marcar");
    const tarea = await crearTarea(cookie, {
      titulo: "Semanal",
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY",
    });

    const marcar = await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: true },
    });
    expect(marcar.statusCode).toBe(204);

    const repetir = await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: true },
    });
    expect(repetir.statusCode).toBe(204);
    expect(await db.select().from(ocurrenciasHechas)).toHaveLength(1);

    const agenda = await app.inject({
      method: "GET",
      url: "/agenda?desde=2026-05-01T00:00:00.000Z&hasta=2026-05-31T23:59:59.000Z",
      headers: { cookie: `sesion=${cookie}` },
    });
    const ocurrencias = agenda.json() as Array<{ fecha: string; hecha: boolean }>;
    expect(ocurrencias.find((o) => o.fecha === "2026-05-10T10:00:00.000Z")?.hecha).toBe(true);
    expect(ocurrencias.find((o) => o.fecha === "2026-05-17T10:00:00.000Z")?.hecha).toBe(false);

    const desmarcar = await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: false },
    });
    expect(desmarcar.statusCode).toBe(204);
    expect(await db.select().from(ocurrenciasHechas)).toHaveLength(0);
  });

  it("rechaza una fecha que no es ocurrencia", async () => {
    const cookie = await registrar("invalida");
    const tarea = await crearTarea(cookie, {
      titulo: "Simple",
      venceEn: "2026-05-10T10:00:00.000Z",
    });

    const respuesta = await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha: "2026-05-11T10:00:00.000Z", hecha: true },
    });
    expect(respuesta.statusCode).toBe(400);
    expect(respuesta.json()).toMatchObject({
      mensaje: "La fecha no es una ocurrencia de la tarea",
    });
  });

  it("no deja marcar una tarea ajena", async () => {
    const alice = await registrar("alice");
    const bob = await registrar("bob");
    const tarea = await crearTarea(alice, {
      titulo: "Privada",
      venceEn: "2026-05-10T10:00:00.000Z",
    });

    const respuesta = await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${bob}` },
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: true },
    });
    expect(respuesta.statusCode).toBe(404);
  });

  it("el procesador omite la hecha y avisa de la siguiente", async () => {
    const cookie = await registrar("avisos");
    const tarea = await crearTarea(cookie, {
      titulo: "Con avisos",
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY",
    });

    await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: true },
    });

    const canal = new CanalFalso();
    const primeraPasada = await procesarAvisos(
      db as unknown as Database,
      new Date("2026-05-10T10:00:00.000Z"),
      new Date("2026-05-10T09:00:00.000Z"),
      [canal],
    );
    expect(primeraPasada).toEqual({ enviados: 0, fallidos: 0 });
    expect(canal.enviados).toHaveLength(0);

    const segundaPasada = await procesarAvisos(
      db as unknown as Database,
      new Date("2026-05-17T10:00:00.000Z"),
      new Date("2026-05-17T09:00:00.000Z"),
      [canal],
    );
    expect(segundaPasada).toEqual({ enviados: 1, fallidos: 0 });
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]).toContain("17/05/2026 12:00");
  });

  it("borrar la tarea borra sus marcas", async () => {
    const cookie = await registrar("borrado");
    const tarea = await crearTarea(cookie, {
      titulo: "Se borra",
      venceEn: "2026-05-10T10:00:00.000Z",
    });

    await app.inject({
      method: "POST",
      url: `/tareas/${tarea.id}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha: "2026-05-10T10:00:00.000Z", hecha: true },
    });
    expect(await db.select().from(ocurrenciasHechas)).toHaveLength(1);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);
    expect(await db.select().from(ocurrenciasHechas)).toHaveLength(0);
  });
});
