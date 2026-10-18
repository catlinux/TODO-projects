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

interface ElementoActividad {
  tipo: string;
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
  historialTipo?: string;
  texto?: string;
  accion?: string;
  etiquetaId?: string;
  nombre?: string;
  desde?: string | null;
  hasta?: string | null;
  antes?: unknown;
  despues?: unknown;
}

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("historial y actividad de la tarea", () => {
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

  async function registrar(sufijo: string): Promise<{ cookie: string }> {
    const email = `historial-${sufijo}@example.com`;
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
    });
    return { cookie: obtenerCookieSesion(respuesta) };
  }

  async function crearProyecto(cookie: string, nombre: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function crearTarea(cookie: string, proyectoId: string, titulo: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function listarColumnas(
    cookie: string,
    proyectoId: string,
  ): Promise<Array<{ id: string; nombre: string }>> {
    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as Array<{ id: string; nombre: string }>;
  }

  async function listarHistorial(
    cookie: string,
    tareaId: string,
    pagina?: number,
  ): Promise<{ elementos: ElementoActividad[]; hayMas: boolean }> {
    const url = pagina
      ? `/tareas/${tareaId}/actividad?pagina=${pagina}`
      : `/tareas/${tareaId}/actividad`;
    const respuesta = await app.inject({
      method: "GET",
      url,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as { elementos: ElementoActividad[]; hayMas: boolean };
  }

  async function historialDe(
    cookie: string,
    tareaId: string,
    tipo: string,
  ): Promise<ElementoActividad[]> {
    const { elementos } = await listarHistorial(cookie, tareaId);
    return elementos.filter(
      (elemento) => elemento.tipo === "historial" && elemento.historialTipo === tipo,
    );
  }

  it("registra la creación de la tarea", async () => {
    const { cookie } = await registrar("creada");
    const proyectoId = await crearProyecto(cookie, "Proyecto creada");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea nueva");

    const creada = await historialDe(cookie, tareaId, "creada");
    expect(creada).toHaveLength(1);
    expect(creada[0]).toMatchObject({ tipo: "historial", historialTipo: "creada" });
  });

  it("registra el cambio de columna y no lo duplica sin cambio", async () => {
    const { cookie } = await registrar("movida");
    const proyectoId = await crearProyecto(cookie, "Proyecto movida");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea que se mueve");
    const columnas = await listarColumnas(cookie, proyectoId);
    const origen = columnas[0]!;
    const destino = columnas[1]!;

    const movimiento = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { columnaId: destino.id },
    });
    expect(movimiento.statusCode).toBe(200);

    const movidas = await historialDe(cookie, tareaId, "movida");
    expect(movidas).toHaveLength(1);
    expect(movidas[0]).toMatchObject({
      desde: origen.nombre,
      hasta: destino.nombre,
    });

    // Mover a la misma columna no es un cambio real.
    const sinCambio = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { columnaId: destino.id },
    });
    expect(sinCambio.statusCode).toBe(200);
    expect(await historialDe(cookie, tareaId, "movida")).toHaveLength(1);
  });

  it("registra el cambio de fecha solo cuando cambia", async () => {
    const { cookie } = await registrar("fecha");
    const proyectoId = await crearProyecto(cookie, "Proyecto fecha");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con fecha");
    const fecha = "2030-03-01T09:00:00.000Z";

    const primera = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { venceEn: fecha },
    });
    expect(primera.statusCode).toBe(200);

    const fechas = await historialDe(cookie, tareaId, "fecha");
    expect(fechas).toHaveLength(1);
    expect(fechas[0]).toMatchObject({ antes: null, despues: fecha });

    const repetida = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { venceEn: fecha },
    });
    expect(repetida.statusCode).toBe(200);
    expect(await historialDe(cookie, tareaId, "fecha")).toHaveLength(1);

    const quitada = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { venceEn: null },
    });
    expect(quitada.statusCode).toBe(200);
    const despues = await historialDe(cookie, tareaId, "fecha");
    expect(despues).toHaveLength(2);
    expect(despues[0]).toMatchObject({ antes: fecha, despues: null });
  });

  it("registra añadir y quitar etiquetas", async () => {
    const { cookie } = await registrar("etiqueta");
    const proyectoId = await crearProyecto(cookie, "Proyecto etiqueta");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea etiquetada");

    const crearEtiqueta = async (nombre: string, color: string): Promise<string> => {
      const respuesta = await app.inject({
        method: "POST",
        url: `/proyectos/${proyectoId}/etiquetas`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { nombre, color },
      });
      expect(respuesta.statusCode).toBe(201);
      return (respuesta.json() as { id: string }).id;
    };

    const urgente = await crearEtiqueta("Urgente", "#C8303A");
    const casa = await crearEtiqueta("Casa", "#0E7490");

    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [urgente, casa] },
    });

    const anadidas = (await historialDe(cookie, tareaId, "etiqueta")).filter(
      (elemento) => elemento.accion === "añadida",
    );
    expect(anadidas).toHaveLength(2);
    expect(anadidas.map((elemento) => elemento.nombre).sort()).toEqual(["Casa", "Urgente"]);

    // Repetir el mismo conjunto no añade historial.
    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [urgente, casa] },
    });
    expect(await historialDe(cookie, tareaId, "etiqueta")).toHaveLength(2);

    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [urgente] },
    });
    const quitadas = (await historialDe(cookie, tareaId, "etiqueta")).filter(
      (elemento) => elemento.accion === "quitada",
    );
    expect(quitadas).toHaveLength(1);
    expect(quitadas[0]).toMatchObject({ etiquetaId: casa, nombre: "Casa" });
  });

  it("registra completar un elemento del checklist", async () => {
    const { cookie } = await registrar("checklist");
    const proyectoId = await crearProyecto(cookie, "Proyecto checklist historial");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con pasos");

    const creacion = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Comprar pan" },
    });
    const elementoId = (creacion.json() as { id: string }).id;

    const marcar = async (hecho: boolean) =>
      app.inject({
        method: "PATCH",
        url: `/checklist/${elementoId}`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { hecho },
      });

    expect((await marcar(true)).statusCode).toBe(200);
    const completados = await historialDe(cookie, tareaId, "checklist");
    expect(completados).toHaveLength(1);
    expect(completados[0]).toMatchObject({ texto: "Comprar pan" });

    // Volver a marcar como hecho sin transición no duplica.
    expect((await marcar(true)).statusCode).toBe(200);
    expect(await historialDe(cookie, tareaId, "checklist")).toHaveLength(1);

    // Desmarcar no registra historial.
    expect((await marcar(false)).statusCode).toBe(200);
    expect(await historialDe(cookie, tareaId, "checklist")).toHaveLength(1);
  });

  it("registra los cambios de portada y rechaza los inválidos", async () => {
    const { cookie } = await registrar("portada");
    const proyectoId = await crearProyecto(cookie, "Proyecto portada");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con portada");

    const color = { tipo: "color", valor: "#6E4FE6" };
    const asignada = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { portada: color },
    });
    expect(asignada.statusCode).toBe(200);
    expect((asignada.json() as { portada: unknown }).portada).toEqual(color);

    let cambios = await historialDe(cookie, tareaId, "portada");
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({ antes: null, despues: color });

    // La misma portada no genera historial.
    const repetida = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { portada: color },
    });
    expect(repetida.statusCode).toBe(200);
    expect(await historialDe(cookie, tareaId, "portada")).toHaveLength(1);

    const patron = { tipo: "color", valor: "rayas-ambar" };
    const otra = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { portada: patron },
    });
    expect(otra.statusCode).toBe(200);
    cambios = await historialDe(cookie, tareaId, "portada");
    expect(cambios).toHaveLength(2);
    expect(cambios[0]).toMatchObject({ antes: color, despues: patron });

    const quitada = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { portada: null },
    });
    expect(quitada.statusCode).toBe(200);
    expect((quitada.json() as { portada: unknown }).portada).toBeNull();

    expect(await historialDe(cookie, tareaId, "portada")).toHaveLength(3);

    const invalida = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { portada: { tipo: "color", valor: "no-existe" } },
    });
    expect(invalida.statusCode).toBe(400);

    const imagen = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { portada: { tipo: "imagen", archivoId: "11111111-1111-4111-8111-111111111111" } },
    });
    expect(imagen.statusCode).toBe(400);
  });

  it("mezcla comentarios e historial y pagina de 50 en 50", async () => {
    const { cookie } = await registrar("paginado");
    const proyectoId = await crearProyecto(cookie, "Proyecto paginado");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con mucha actividad");

    const comentar = (texto: string) =>
      app.inject({
        method: "POST",
        url: `/tareas/${tareaId}/comentarios`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { texto },
      });

    for (let i = 0; i < 30; i += 1) {
      expect((await comentar(`Comentario ${i}`)).statusCode).toBe(201);
    }

    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/tareas/${tareaId}`,
          headers: { cookie: `sesion=${cookie}` },
          payload: { venceEn: "2030-05-05T12:00:00.000Z" },
        })
      ).statusCode,
    ).toBe(200);

    for (let i = 30; i < 60; i += 1) {
      expect((await comentar(`Comentario ${i}`)).statusCode).toBe(201);
    }

    const primera = await listarHistorial(cookie, tareaId, 1);
    expect(primera.elementos).toHaveLength(50);
    expect(primera.hayMas).toBe(true);

    const segunda = await listarHistorial(cookie, tareaId, 2);
    expect(segunda.elementos).toHaveLength(12);
    expect(segunda.hayMas).toBe(false);

    const todas = [...primera.elementos, ...segunda.elementos];
    expect(todas.filter((elemento) => elemento.tipo === "comentario")).toHaveLength(60);
    expect(todas.filter((elemento) => elemento.tipo === "historial")).toHaveLength(2);
    expect(new Set(todas.map((elemento) => elemento.id)).size).toBe(62);

    for (const elemento of todas) {
      expect(elemento.usuarioNombre).toBe("Usuario paginado");
      expect(typeof elemento.creadoEn).toBe("string");
    }

    // Orden descendente por fecha entre páginas.
    const fechas = todas.map((elemento) => Date.parse(elemento.creadoEn));
    for (let i = 1; i < fechas.length; i += 1) {
      expect(fechas[i - 1]!).toBeGreaterThanOrEqual(fechas[i]!);
    }
  });

  it("devuelve 404 para la actividad de una tarea ajena", async () => {
    const alice = await registrar("alice-ajena");
    const bob = await registrar("bob-ajena");
    const proyectoId = await crearProyecto(alice.cookie, "Proyecto de Alice");
    const tareaId = await crearTarea(alice.cookie, proyectoId, "Tarea de Alice");

    const ajena = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/actividad`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(ajena.statusCode).toBe(404);
  });
});
