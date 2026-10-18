import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { and, count, eq } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import { excepcionesOcurrencia, historialTarea } from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

interface Ocurrencia {
  tareaId: string;
  titulo: string;
  fecha: string;
  fechaOriginal: string;
  conExcepcion: boolean;
  esRecurrente: boolean;
  hecha: boolean;
  recordatorioMin: number | null;
}

describe("excepciones de ocurrencia", () => {
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

  async function registrar(sufijo: string) {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `excepciones-${sufijo}@example.com`,
        nombre: sufijo,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  async function crearProyecto(cookie: string, nombre: string) {
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

  async function crearTarea(
    cookie: string,
    proyectoId: string,
    datos: { titulo: string; columnaId: string; venceEn: string; recurrencia?: string | null },
  ) {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: datos,
    });
    return (respuesta.json() as { id: string }).id;
  }

  function ponerExcepcion(
    cookie: string,
    tareaId: string,
    cuerpo: Record<string, unknown>,
  ) {
    return app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/excepciones`,
      headers: { cookie: `sesion=${cookie}` },
      payload: cuerpo,
    });
  }

  function quitarExcepcion(cookie: string, tareaId: string, fechaOriginal: string) {
    return app.inject({
      method: "DELETE",
      url: `/tareas/${tareaId}/excepciones?fechaOriginal=${encodeURIComponent(fechaOriginal)}`,
      headers: { cookie: `sesion=${cookie}` },
    });
  }

  async function consultarAgenda(cookie: string, desde: string, hasta: string) {
    const respuesta = await app.inject({
      method: "GET",
      url: `/agenda?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    return respuesta.json() as Ocurrencia[];
  }

  async function marcarOcurrencia(
    cookie: string,
    tareaId: string,
    fecha: string,
    hecha: boolean,
  ) {
    return app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/ocurrencias`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { fecha, hecha },
    });
  }

  const MAYO = ["2026-05-01T00:00:00.000Z", "2026-05-31T23:59:59.000Z"] as const;
  const JUNIO = ["2026-06-01T00:00:00.000Z", "2026-06-30T23:59:59.000Z"] as const;

  it("crea, reemplaza y restaura la excepción de una ocurrencia", async () => {
    const cookie = await registrar("crud");
    const proyecto = await crearProyecto(cookie, "CRUD");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    const creacion = await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      omitida: true,
    });
    expect(creacion.statusCode).toBe(200);
    expect(creacion.json()).toMatchObject({
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      fechaNueva: null,
      omitida: true,
      titulo: null,
    });

    const conOmitida = await consultarAgenda(cookie, ...MAYO);
    expect(conOmitida.map((o) => o.fecha)).not.toContain("2026-05-11T10:00:00.000Z");
    expect(conOmitida).toHaveLength(4);

    // Reemplazar la misma fecha: deja de estar omitida y pasa a moverse.
    const reemplazo = await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      fechaNueva: "2026-05-11T15:30:00.000Z",
    });
    expect(reemplazo.statusCode).toBe(200);
    expect(reemplazo.json()).toMatchObject({
      fechaNueva: "2026-05-11T15:30:00.000Z",
      omitida: false,
    });

    const conMovida = await consultarAgenda(cookie, ...MAYO);
    const movida = conMovida.find((o) => o.fechaOriginal === "2026-05-11T10:00:00.000Z");
    expect(movida).toMatchObject({
      fecha: "2026-05-11T15:30:00.000Z",
      conExcepcion: true,
      esRecurrente: true,
    });
    expect(conMovida.map((o) => o.fecha)).not.toContain("2026-05-11T10:00:00.000Z");

    const restauracion = await quitarExcepcion(cookie, tareaId, "2026-05-11T10:00:00.000Z");
    expect(restauracion.statusCode).toBe(204);

    const restaurada = await consultarAgenda(cookie, ...MAYO);
    const vuelta = restaurada.find((o) => o.fecha === "2026-05-11T10:00:00.000Z");
    expect(vuelta).toMatchObject({ conExcepcion: false, fechaOriginal: "2026-05-11T10:00:00.000Z" });

    const segundaVez = await quitarExcepcion(cookie, tareaId, "2026-05-11T10:00:00.000Z");
    expect(segundaVez.statusCode).toBe(404);
  });

  it("rechaza una fecha que no es ocurrencia de la serie", async () => {
    const cookie = await registrar("fecha-invalida");
    const proyecto = await crearProyecto(cookie, "Fecha inválida");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    const respuesta = await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-13T11:00:00.000Z",
      omitida: true,
    });
    expect(respuesta.statusCode).toBe(400);
    const [guardadas] = await db
      .select({ total: count() })
      .from(excepcionesOcurrencia)
      .where(eq(excepcionesOcurrencia.tareaId, tareaId));
    expect(guardadas?.total).toBe(0);
  });

  it("rechaza una tarea no recurrente y un cuerpo sin cambios", async () => {
    const cookie = await registrar("no-recurrente");
    const proyecto = await crearProyecto(cookie, "No recurrente");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Simple",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
    });

    const noRecurrente = await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-10T10:00:00.000Z",
      omitida: true,
    });
    expect(noRecurrente.statusCode).toBe(400);

    const recurrenteId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    const sinCambios = await ponerExcepcion(cookie, recurrenteId, {
      fechaOriginal: "2026-05-10T10:00:00.000Z",
    });
    expect(sinCambios.statusCode).toBe(400);

    const omitidaYMovida = await ponerExcepcion(cookie, recurrenteId, {
      fechaOriginal: "2026-05-10T10:00:00.000Z",
      omitida: true,
      fechaNueva: "2026-05-10T12:00:00.000Z",
    });
    expect(omitidaYMovida.statusCode).toBe(400);
  });

  it("aísla las excepciones entre usuarios", async () => {
    const alice = await registrar("alice-excepciones");
    const bob = await registrar("bob-excepciones");
    const proyecto = await crearProyecto(alice, "Privado");
    const tareaId = await crearTarea(alice, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    const creacion = await ponerExcepcion(alice, tareaId, {
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      omitida: true,
    });
    expect(creacion.statusCode).toBe(200);

    const ajena = await ponerExcepcion(bob, tareaId, {
      fechaOriginal: "2026-05-12T10:00:00.000Z",
      omitida: true,
    });
    expect(ajena.statusCode).toBe(404);

    const ajenaBorrado = await quitarExcepcion(bob, tareaId, "2026-05-11T10:00:00.000Z");
    expect(ajenaBorrado.statusCode).toBe(404);

    expect(await consultarAgenda(bob, ...MAYO)).toHaveLength(0);
  });

  it("una ocurrencia movida fuera del rango no aparece y una movida hacia dentro sí", async () => {
    const cookie = await registrar("movida-rango");
    const proyecto = await crearProyecto(cookie, "Movida rango");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=90",
    });

    // Se va de mayo a junio: en mayo desaparece y en junio aparece.
    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-12T10:00:00.000Z",
      fechaNueva: "2026-06-20T10:00:00.000Z",
    });
    // Llega de julio a mayo: aparece en mayo aunque su original quede fuera.
    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-07-10T10:00:00.000Z",
      fechaNueva: "2026-05-20T10:00:00.000Z",
    });

    const mayo = await consultarAgenda(cookie, ...MAYO);
    expect(mayo.map((o) => o.fecha)).not.toContain("2026-05-12T10:00:00.000Z");
    const llegada = mayo.find((o) => o.fechaOriginal === "2026-07-10T10:00:00.000Z");
    expect(llegada).toMatchObject({
      fecha: "2026-05-20T10:00:00.000Z",
      conExcepcion: true,
    });
    // 22 días de mayo (10 al 31): uno se va a junio y entra uno de julio.
    expect(mayo).toHaveLength(22);

    const junio = await consultarAgenda(cookie, ...JUNIO);
    const salida = junio.find((o) => o.fechaOriginal === "2026-05-12T10:00:00.000Z");
    expect(salida).toMatchObject({
      fechaOriginal: "2026-05-12T10:00:00.000Z",
      conExcepcion: true,
    });

    const julio = await consultarAgenda(cookie, "2026-07-01T00:00:00.000Z", "2026-07-31T23:59:59.000Z");
    expect(julio.map((o) => o.fecha)).not.toContain("2026-07-10T10:00:00.000Z");
  });

  it("marcar hecha una ocurrencia movida funciona con su fecha original", async () => {
    const cookie = await registrar("hecha-movida");
    const proyecto = await crearProyecto(cookie, "Hecha movida");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      fechaNueva: "2026-05-20T10:00:00.000Z",
    });

    const marcado = await marcarOcurrencia(cookie, tareaId, "2026-05-11T10:00:00.000Z", true);
    expect(marcado.statusCode).toBe(204);

    const mayo = await consultarAgenda(cookie, ...MAYO);
    const movida = mayo.find((o) => o.fechaOriginal === "2026-05-11T10:00:00.000Z");
    expect(movida).toMatchObject({
      fecha: "2026-05-20T10:00:00.000Z",
      hecha: true,
      conExcepcion: true,
    });
    expect(mayo.map((o) => o.fecha)).not.toContain("2026-05-11T10:00:00.000Z");

    // Marcar una ocurrencia omitida tampoco se rechaza.
    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-12T10:00:00.000Z",
      omitida: true,
    });
    const marcadoOmitida = await marcarOcurrencia(
      cookie,
      tareaId,
      "2026-05-12T10:00:00.000Z",
      true,
    );
    expect(marcadoOmitida.statusCode).toBe(204);
  });

  it("renombrar una sola ocurrencia sin moverla cambia su título", async () => {
    const cookie = await registrar("renombrar");
    const proyecto = await crearProyecto(cookie, "Renombrar");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=3",
    });

    const respuesta = await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      titulo: "Solo esta",
    });
    expect(respuesta.statusCode).toBe(200);

    const mayo = await consultarAgenda(cookie, ...MAYO);
    const renombrada = mayo.find((o) => o.fecha === "2026-05-11T10:00:00.000Z");
    expect(renombrada).toMatchObject({
      titulo: "Solo esta",
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      conExcepcion: true,
    });
    const otra = mayo.find((o) => o.fecha === "2026-05-10T10:00:00.000Z");
    expect(otra).toMatchObject({ titulo: "Diaria", conExcepcion: false });
  });

  it("borrar la tarea borra sus excepciones", async () => {
    const cookie = await registrar("borrado");
    const proyecto = await crearProyecto(cookie, "Borrado");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      omitida: true,
    });
    const [antes] = await db
      .select({ total: count() })
      .from(excepcionesOcurrencia)
      .where(eq(excepcionesOcurrencia.tareaId, tareaId));
    expect(antes?.total).toBe(1);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const [despues] = await db
      .select({ total: count() })
      .from(excepcionesOcurrencia)
      .where(eq(excepcionesOcurrencia.tareaId, tareaId));
    expect(despues?.total).toBe(0);
  });

  it("registra el historial una sola vez por cambio real", async () => {
    const cookie = await registrar("historial");
    const proyecto = await crearProyecto(cookie, "Historial");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Diaria",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=DAILY;COUNT=5",
    });

    const cuerpo = { fechaOriginal: "2026-05-11T10:00:00.000Z", fechaNueva: "2026-05-11T14:00:00.000Z" };
    await ponerExcepcion(cookie, tareaId, cuerpo);
    await ponerExcepcion(cookie, tareaId, cuerpo);

    const fechaHistorial = async () =>
      (
        await db
          .select({ total: count() })
          .from(historialTarea)
          .where(and(eq(historialTarea.tareaId, tareaId), eq(historialTarea.tipo, "fecha")))
      )[0]?.total ?? 0;

    expect(await fechaHistorial()).toBe(1);

    const [entrada] = await db
      .select({ datos: historialTarea.datos })
      .from(historialTarea)
      .where(and(eq(historialTarea.tareaId, tareaId), eq(historialTarea.tipo, "fecha")))
      .limit(1);
    expect(entrada?.datos).toMatchObject({
      fechaOriginal: "2026-05-11T10:00:00.000Z",
      antes: null,
      despues: { fechaNueva: "2026-05-11T14:00:00.000Z" },
    });

    await quitarExcepcion(cookie, tareaId, "2026-05-11T10:00:00.000Z");
    expect(await fechaHistorial()).toBe(2);
  });

  it("exporta las excepciones en el .ics", async () => {
    const cookie = await registrar("ics");
    const proyecto = await crearProyecto(cookie, "Ics");
    const tareaId = await crearTarea(cookie, proyecto.id, {
      titulo: "Semanal",
      columnaId: proyecto.columnaId,
      venceEn: "2026-05-10T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=4",
    });

    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-17T10:00:00.000Z",
      omitida: true,
    });
    await ponerExcepcion(cookie, tareaId, {
      fechaOriginal: "2026-05-24T10:00:00.000Z",
      fechaNueva: "2026-05-25T10:00:00.000Z",
      titulo: "Movida",
    });

    const respuesta = await app.inject({
      method: "GET",
      url: "/agenda.ics",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.body;
    expect(cuerpo).toContain("EXDATE;TZID=Europe/Madrid:20260517T120000");
    expect(cuerpo).toContain("EXDATE;TZID=Europe/Madrid:20260524T120000");
    expect(cuerpo).toContain("RECURRENCE-ID;TZID=Europe/Madrid:20260524T120000");
    expect(cuerpo).toContain("DTSTART;TZID=Europe/Madrid:20260525T120000");
    expect(cuerpo).toContain("SUMMARY:Movida");
  });
});
