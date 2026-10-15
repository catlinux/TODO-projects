import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  if (!coincidencia || !coincidencia[1]) return "";
  return coincidencia[1];
}

async function registrar(app: FastifyInstance, sufijo: string) {
  const respuesta = await app.inject({
    method: "POST",
    url: "/auth/registro",
    payload: {
      email: `agenda-${sufijo}@example.com`,
      nombre: sufijo,
      contrasena: "contrasena-muy-larga",
    },
  });
  return { cookie: obtenerCookie(respuesta) };
}

async function crearProyecto(app: FastifyInstance, cookie: string, nombre = "Proyecto") {
  const respuesta = await app.inject({
    method: "POST",
    url: "/proyectos",
    headers: { cookie: `sesion=${cookie}` },
    payload: { nombre },
  });
  const proyecto = respuesta.json() as { id: string };
  const columnasRespuesta = await app.inject({
    method: "GET",
    url: `/proyectos/${proyecto.id}/columnas`,
    headers: { cookie: `sesion=${cookie}` },
  });
  const columnas = columnasRespuesta.json() as Array<{ id: string }>;
  return { id: proyecto.id, columnaId: columnas[0]!.id };
}

interface DatosTarea {
  titulo: string;
  columnaId: string;
  venceEn?: string | null;
  recurrencia?: string | null;
  zona?: string;
}

async function crearTarea(
  app: FastifyInstance,
  cookie: string,
  proyectoId: string,
  datos: DatosTarea,
) {
  return app.inject({
    method: "POST",
    url: `/proyectos/${proyectoId}/tareas`,
    headers: { cookie: `sesion=${cookie}` },
    payload: datos,
  });
}

async function consultarAgenda(app: FastifyInstance, cookie: string, desde: string, hasta: string) {
  return app.inject({
    method: "GET",
    url: `/agenda?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
    headers: { cookie: `sesion=${cookie}` },
  });
}

interface Ocurrencia {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  columnaId: string;
  columnaNombre: string;
  fecha: string;
  esRecurrente: boolean;
}

describe("agenda", () => {
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
  });

  it("exige sesión", async () => {
    const respuesta = await app.inject({
      method: "GET",
      url: "/agenda?desde=2026-01-01T00:00:00.000Z&hasta=2026-01-31T00:00:00.000Z",
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it("valida los parámetros del rango", async () => {
    const { cookie } = await registrar(app, "validacion");

    const sinParametros = await app.inject({
      method: "GET",
      url: "/agenda",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(sinParametros.statusCode).toBe(400);

    const invertido = await consultarAgenda(
      app,
      cookie,
      "2026-02-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    expect(invertido.statusCode).toBe(400);

    const excesivo = await consultarAgenda(
      app,
      cookie,
      "2026-01-01T00:00:00.000Z",
      "2027-06-01T00:00:00.000Z",
    );
    expect(excesivo.statusCode).toBe(400);
  });

  it("devuelve tareas simples dentro del rango y ninguna fuera", async () => {
    const { cookie } = await registrar(app, "simple");
    const proyecto = await crearProyecto(app, cookie, "Simple");

    const creacion = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Reunión",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
    });
    expect(creacion.statusCode).toBe(201);

    const dentro = await consultarAgenda(
      app,
      cookie,
      "2026-05-01T00:00:00.000Z",
      "2026-05-31T23:59:59.000Z",
    );
    expect(dentro.statusCode).toBe(200);
    const ocurrencias = dentro.json() as Ocurrencia[];
    expect(ocurrencias).toHaveLength(1);
    expect(ocurrencias[0]).toMatchObject({
      titulo: "Reunión",
      proyectoNombre: "Simple",
      fecha: "2026-05-10T10:00:00.000Z",
      esRecurrente: false,
    });
    expect(ocurrencias[0]!.tareaId).toBeTruthy();
    expect(ocurrencias[0]!.columnaNombre).toBe("Pendiente");

    const fuera = await consultarAgenda(
      app,
      cookie,
      "2026-06-01T00:00:00.000Z",
      "2026-06-30T23:59:59.000Z",
    );
    expect((fuera.json() as Ocurrencia[]).length).toBe(0);
  });

  it("expande una tarea recurrente semanal", async () => {
    const { cookie } = await registrar(app, "recurrente");
    const proyecto = await crearProyecto(app, cookie, "Recurrente");

    const creacion = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Semanal",
      columnaId: proyecto.columnaId,
      venceEn: "2026-03-02T08:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
    });
    expect(creacion.statusCode).toBe(201);
    expect((creacion.json() as { recurrencia: string }).recurrencia).toBe("FREQ=WEEKLY;COUNT=3");

    const respuesta = await consultarAgenda(
      app,
      cookie,
      "2026-03-01T00:00:00.000Z",
      "2026-03-31T23:59:59.000Z",
    );
    const ocurrencias = respuesta.json() as Ocurrencia[];
    expect(ocurrencias.map((o) => o.fecha)).toEqual([
      "2026-03-02T08:00:00.000Z",
      "2026-03-09T08:00:00.000Z",
      "2026-03-16T08:00:00.000Z",
    ]);
    expect(ocurrencias.every((o) => o.esRecurrente)).toBe(true);
  });

  it("ordena las ocurrencias por fecha", async () => {
    const { cookie } = await registrar(app, "orden");
    const proyecto = await crearProyecto(app, cookie, "Orden");

    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Tarde",
      columnaId: proyecto.columnaId,
      venceEn: "2026-07-20T18:00:00.000Z",
    });
    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Temprano",
      columnaId: proyecto.columnaId,
      venceEn: "2026-07-20T06:00:00.000Z",
    });

    const respuesta = await consultarAgenda(
      app,
      cookie,
      "2026-07-01T00:00:00.000Z",
      "2026-07-31T23:59:59.000Z",
    );
    const fechas = (respuesta.json() as Ocurrencia[]).map((o) => o.fecha);
    expect(fechas).toEqual(["2026-07-20T06:00:00.000Z", "2026-07-20T18:00:00.000Z"]);
  });

  it("aísla las tareas entre usuarios", async () => {
    const alice = await registrar(app, "alice-agenda");
    const bob = await registrar(app, "bob-agenda");
    const proyecto = await crearProyecto(app, alice.cookie, "Privado");

    await crearTarea(app, alice.cookie, proyecto.id, {
      titulo: "Solo de Alice",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
    });

    const respuesta = await consultarAgenda(
      app,
      bob.cookie,
      "2026-05-01T00:00:00.000Z",
      "2026-05-31T23:59:59.000Z",
    );
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toEqual([]);
  });

  it("borra fecha y recurrencia con PATCH", async () => {
    const { cookie } = await registrar(app, "borrado");
    const proyecto = await crearProyecto(app, cookie, "Borrado");

    const creacion = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Con recurrencia",
      columnaId: proyecto.columnaId,
      venceEn: "2026-09-10T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
    });
    const tarea = creacion.json() as { id: string };

    const borrado = await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { venceEn: null },
    });
    expect(borrado.statusCode).toBe(200);
    const actualizada = borrado.json() as { venceEn: string | null; recurrencia: string | null };
    expect(actualizada.venceEn).toBeNull();
    expect(actualizada.recurrencia).toBeNull();

    const agenda = await consultarAgenda(
      app,
      cookie,
      "2026-09-01T00:00:00.000Z",
      "2026-09-30T23:59:59.000Z",
    );
    expect(agenda.json()).toEqual([]);
  });

  it("rechaza una recurrencia sin fecha", async () => {
    const { cookie } = await registrar(app, "sin-fecha");
    const proyecto = await crearProyecto(app, cookie, "Sin fecha");

    const creacion = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Sin fecha",
      columnaId: proyecto.columnaId,
      recurrencia: "FREQ=DAILY;COUNT=3",
    });
    expect(creacion.statusCode).toBe(400);

    const sinFecha = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Sin fecha",
      columnaId: proyecto.columnaId,
    });
    const tarea = sinFecha.json() as { id: string };

    const patch = await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { recurrencia: "FREQ=DAILY;COUNT=3" },
    });
    expect(patch.statusCode).toBe(400);
    expect(patch.json()).toMatchObject({ mensaje: "Una tarea recurrente necesita fecha" });
  });

  it("rechaza una regla de recurrencia inválida", async () => {
    const { cookie } = await registrar(app, "regla");
    const proyecto = await crearProyecto(app, cookie, "Regla");

    const creacion = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Regla mala",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=HOURLY",
    });
    expect(creacion.statusCode).toBe(400);
  });

  it("incluye recurrentes empezados antes del rango", async () => {
    const { cookie } = await registrar(app, "antes");
    const proyecto = await crearProyecto(app, cookie, "Antes");

    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Semanal larga",
      columnaId: proyecto.columnaId,
      venceEn: "2026-01-05T08:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=10",
    });

    const respuesta = await consultarAgenda(
      app,
      cookie,
      "2026-03-01T00:00:00.000Z",
      "2026-03-31T23:59:59.000Z",
    );
    const fechas = (respuesta.json() as Ocurrencia[]).map((o) => o.fecha);
    expect(fechas).toEqual(["2026-03-02T08:00:00.000Z", "2026-03-09T08:00:00.000Z"]);
  });

  it("borra solo la recurrencia manteniendo la fecha", async () => {
    const { cookie } = await registrar(app, "solo-recurrencia");
    const proyecto = await crearProyecto(app, cookie, "Solo recurrencia");

    const creacion = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Varias",
      columnaId: proyecto.columnaId,
      venceEn: "2026-09-10T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
    });
    const tarea = creacion.json() as { id: string };

    const patch = await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { recurrencia: null },
    });
    expect(patch.statusCode).toBe(200);
    const actualizada = patch.json() as { venceEn: string | null; recurrencia: string | null };
    expect(actualizada.recurrencia).toBeNull();
    expect(actualizada.venceEn).not.toBeNull();

    const respuesta = await consultarAgenda(
      app,
      cookie,
      "2026-09-01T00:00:00.000Z",
      "2026-09-30T23:59:59.000Z",
    );
    const ocurrencias = respuesta.json() as Ocurrencia[];
    expect(ocurrencias).toHaveLength(1);
    expect(ocurrencias[0]!.esRecurrente).toBe(false);
  });

  it("exige sesión para el .ics", async () => {
    const respuesta = await app.inject({ method: "GET", url: "/agenda.ics" });
    expect(respuesta.statusCode).toBe(401);
  });

  it("exporta en .ics las tareas con fecha", async () => {
    const { cookie } = await registrar(app, "ics");
    const proyecto = await crearProyecto(app, cookie, "Ics");

    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Con fecha",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
    });
    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Sin fecha",
      columnaId: proyecto.columnaId,
    });
    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Recurrente",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-11T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;BYDAY=MO",
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/agenda.ics",
      headers: { cookie: `sesion=${cookie}` },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers["content-type"]).toContain("text/calendar");
    expect(respuesta.headers["content-type"]).toContain("charset=utf-8");
    expect(respuesta.headers["content-disposition"]).toContain("attachment");
    expect(respuesta.headers["content-disposition"]).toContain("todo-projects.ics");

    const cuerpo = respuesta.body;
    expect(cuerpo).toContain("BEGIN:VCALENDAR\r\n");
    expect(cuerpo).toContain("SUMMARY:Con fecha");
    expect(cuerpo).toContain("SUMMARY:Recurrente");
    expect(cuerpo).not.toContain("SUMMARY:Sin fecha");
    expect(cuerpo).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(cuerpo).toContain("CATEGORIES:Ics");
    expect(cuerpo).toContain("TZID:Europe/Madrid");
    expect(cuerpo).toContain("DTSTART;TZID=Europe/Madrid:20260511T120000");
  });

  it("no exporta tareas de otro usuario", async () => {
    const alice = await registrar(app, "ics-alice");
    const bob = await registrar(app, "ics-bob");
    const proyecto = await crearProyecto(app, alice.cookie, "Ajeno");

    await crearTarea(app, alice.cookie, proyecto.id, {
      titulo: "Privada",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/agenda.ics",
      headers: { cookie: `sesion=${bob.cookie}` },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).not.toContain("SUMMARY:Privada");
  });

  it("guarda la zona por defecto y la explícita", async () => {
    const { cookie } = await registrar(app, "zona");
    const proyecto = await crearProyecto(app, cookie, "Zona");

    const porDefecto = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Sin zona",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
    });
    expect(porDefecto.statusCode).toBe(201);
    expect((porDefecto.json() as { zona: string }).zona).toBe("Europe/Madrid");

    const explicita = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Con zona",
      columnaId: proyecto.columnaId,
      venceEn: "2026-10-26T13:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
      zona: "America/New_York",
    });
    expect(explicita.statusCode).toBe(201);
    const tarea = explicita.json() as { id: string; zona: string };
    expect(tarea.zona).toBe("America/New_York");

    const patch = await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { zona: "UTC" },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { zona: string }).zona).toBe("UTC");
  });

  it("rechaza una zona horaria inválida", async () => {
    const { cookie } = await registrar(app, "zona-invalida");
    const proyecto = await crearProyecto(app, cookie, "Zona inválida");

    const respuesta = await crearTarea(app, cookie, proyecto.id, {
      titulo: "Mala zona",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      zona: "Marte/Olympus",
    });
    expect(respuesta.statusCode).toBe(400);
  });

  it("expande la recurrencia en la zona de la tarea", async () => {
    const { cookie } = await registrar(app, "agenda-zona");
    const proyecto = await crearProyecto(app, cookie, "Agenda zona");

    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Nueva York",
      columnaId: proyecto.columnaId,
      venceEn: "2026-10-26T13:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
      zona: "America/New_York",
    });

    const respuesta = await consultarAgenda(
      app,
      cookie,
      "2026-10-01T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    );
    const fechas = (respuesta.json() as Ocurrencia[]).map((ocurrencia) => ocurrencia.fecha);
    expect(fechas).toEqual([
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-09T14:00:00.000Z",
    ]);
  });

  it("conserva la hora local de Madrid al cruzar octubre", async () => {
    const { cookie } = await registrar(app, "agenda-dst");
    const proyecto = await crearProyecto(app, cookie, "Agenda DST");

    await crearTarea(app, cookie, proyecto.id, {
      titulo: "Semanal local",
      columnaId: proyecto.columnaId,
      venceEn: "2026-10-05T02:17:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=5",
    });

    const respuesta = await consultarAgenda(
      app,
      cookie,
      "2026-10-01T00:00:00.000Z",
      "2026-11-10T00:00:00.000Z",
    );
    const fechas = (respuesta.json() as Ocurrencia[]).map((ocurrencia) => ocurrencia.fecha);
    expect(fechas).toEqual([
      "2026-10-05T02:17:00.000Z",
      "2026-10-12T02:17:00.000Z",
      "2026-10-19T02:17:00.000Z",
      "2026-10-26T03:17:00.000Z",
      "2026-11-02T03:17:00.000Z",
    ]);
  });
});
