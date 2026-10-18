import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

async function registrar(
  app: FastifyInstance,
  sufijo: string,
): Promise<{ cookie: string; email: string }> {
  const email = `etiquetas-${sufijo}@example.com`;
  const respuesta = await app.inject({
    method: "POST",
    url: "/auth/registro",
    payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
  });
  return { cookie: obtenerCookieSesion(respuesta), email };
}

describe("etiquetas por proyecto", () => {
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

  async function crearEtiqueta(
    cookie: string,
    proyectoId: string,
    nombre: string,
    color = "#6E4FE6",
  ): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre, color },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function crearToken(cookie: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Conector", permiso: "escritura" },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { token: string }).token;
  }

  it("exige sesión en las rutas de etiquetas", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const rutas = [
      { method: "GET", url: `/proyectos/${id}/etiquetas` },
      { method: "POST", url: `/proyectos/${id}/etiquetas` },
      { method: "PATCH", url: `/etiquetas/${id}` },
      { method: "DELETE", url: `/etiquetas/${id}` },
      { method: "PUT", url: `/tareas/${id}/etiquetas` },
    ] as const;

    for (const ruta of rutas) {
      const respuesta = await app.inject({ method: ruta.method, url: ruta.url });
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("crea, lista, edita y borra etiquetas", async () => {
    const { cookie } = await registrar(app, "crud");
    const proyectoId = await crearProyecto(cookie, "Proyecto con etiquetas");

    const creacion = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Urgente", color: "#C8303A" },
    });
    expect(creacion.statusCode).toBe(201);
    const etiqueta = creacion.json() as { id: string; nombre: string; color: string };
    expect(etiqueta.nombre).toBe("Urgente");
    expect(etiqueta.color).toBe("#C8303A");

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(listado.statusCode).toBe(200);
    expect(listado.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: etiqueta.id })]),
    );

    const edicion = await app.inject({
      method: "PATCH",
      url: `/etiquetas/${etiqueta.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Muy urgente", color: "#2563D9" },
    });
    expect(edicion.statusCode).toBe(200);
    expect(edicion.json()).toMatchObject({ nombre: "Muy urgente", color: "#2563D9" });

    const borrado = await app.inject({
      method: "DELETE",
      url: `/etiquetas/${etiqueta.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const despues = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(despues.json()).toEqual([]);
  });

  it("valida el color y evita nombres repetidos sin distinguir mayúsculas", async () => {
    const { cookie } = await registrar(app, "validacion");
    const proyectoId = await crearProyecto(cookie, "Proyecto validación");

    const colorInvalido = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Mal color", color: "#123456" },
    });
    expect(colorInvalido.statusCode).toBe(400);

    const nombreVacio = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "", color: "#6E4FE6" },
    });
    expect(nombreVacio.statusCode).toBe(400);

    const etiquetaId = await crearEtiqueta(cookie, proyectoId, "Trabajo", "#18794E");

    const duplicada = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "trabajo", color: "#6E4FE6" },
    });
    expect(duplicada.statusCode).toBe(409);

    const otraEtiquetaId = await crearEtiqueta(cookie, proyectoId, "Casa", "#0E7490");

    const renombradoDuplicado = await app.inject({
      method: "PATCH",
      url: `/etiquetas/${otraEtiquetaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "TRABAJO" },
    });
    expect(renombradoDuplicado.statusCode).toBe(409);

    // Cambiar solo las mayúsculas de la propia etiqueta no es un duplicado.
    const propio = await app.inject({
      method: "PATCH",
      url: `/etiquetas/${etiquetaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "TRABAJO" },
    });
    expect(propio.statusCode).toBe(200);
    expect(propio.json()).toMatchObject({ nombre: "TRABAJO" });

    const colorInvalidoPatch = await app.inject({
      method: "PATCH",
      url: `/etiquetas/${etiquetaId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { color: "#ABCDEF" },
    });
    expect(colorInvalidoPatch.statusCode).toBe(400);
  });

  it("asigna etiquetas a una tarea y las devuelve en el listado", async () => {
    const { cookie } = await registrar(app, "asignar");
    const proyectoId = await crearProyecto(cookie, "Proyecto asignación");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea etiquetada");

    const primera = await crearEtiqueta(cookie, proyectoId, "Primera", "#2563D9");
    const segunda = await crearEtiqueta(cookie, proyectoId, "Segunda", "#4B5563");

    const asignacion = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [primera, segunda, primera] },
    });
    expect(asignacion.statusCode).toBe(200);
    const asignada = asignacion.json() as { etiquetas: string[] };
    expect([...asignada.etiquetas].sort()).toEqual([primera, segunda].sort());

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const tareas = listado.json() as Array<{ id: string; etiquetas: string[] }>;
    const tarea = tareas.find((fila) => fila.id === tareaId);
    expect(tarea?.etiquetas && [...tarea.etiquetas].sort()).toEqual([primera, segunda].sort());

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect((detalle.json() as { etiquetas: string[] }).etiquetas).toHaveLength(2);

    const reemplazo = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [segunda] },
    });
    expect(reemplazo.statusCode).toBe(200);
    expect((reemplazo.json() as { etiquetas: string[] }).etiquetas).toEqual([segunda]);

    const vaciado = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [] },
    });
    expect(vaciado.statusCode).toBe(200);
    expect((vaciado.json() as { etiquetas: string[] }).etiquetas).toEqual([]);
  });

  it("rechaza etiquetas de otro proyecto o inexistentes sin cambios parciales", async () => {
    const { cookie } = await registrar(app, "otro-proyecto");
    const proyectoA = await crearProyecto(cookie, "Proyecto A");
    const proyectoB = await crearProyecto(cookie, "Proyecto B");
    const tareaId = await crearTarea(cookie, proyectoA, "Tarea de A");

    const etiquetaA = await crearEtiqueta(cookie, proyectoA, "De A", "#18794E");
    const etiquetaB = await crearEtiqueta(cookie, proyectoB, "De B", "#A21CAF");

    const mezcla = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaA, etiquetaB] },
    });
    expect(mezcla.statusCode).toBe(400);

    const inexistente = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: ["11111111-1111-1111-1111-111111111111"] },
    });
    expect(inexistente.statusCode).toBe(400);

    const uuidInvalido = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: ["no-es-uuid"] },
    });
    expect(uuidInvalido.statusCode).toBe(400);

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoA}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const tarea = (listado.json() as Array<{ id: string; etiquetas: string[] }>).find(
      (fila) => fila.id === tareaId,
    );
    expect(tarea?.etiquetas).toEqual([]);
  });

  it("al borrar una etiqueta la quita de las tareas", async () => {
    const { cookie } = await registrar(app, "borrar-etiqueta");
    const proyectoId = await crearProyecto(cookie, "Proyecto borrado de etiqueta");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con etiqueta");
    const etiquetaId = await crearEtiqueta(cookie, proyectoId, "Efímera", "#B4530A");

    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaId] },
    });

    const borrado = await app.inject({
      method: "DELETE",
      url: `/etiquetas/${etiquetaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const tarea = (listado.json() as Array<{ id: string; etiquetas: string[] }>).find(
      (fila) => fila.id === tareaId,
    );
    expect(tarea?.etiquetas).toEqual([]);
  });

  it("borrar la tarea o el proyecto limpia las relaciones", async () => {
    const { cookie } = await registrar(app, "cascada");
    const proyectoId = await crearProyecto(cookie, "Proyecto cascada");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea cascada");
    const etiquetaId = await crearEtiqueta(cookie, proyectoId, "Cascada", "#0E7490");

    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaId] },
    });

    await app.inject({
      method: "DELETE",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });

    const relacionesTarea = await db
      .select()
      .from(schema.tareasEtiquetas)
      .where(eq(schema.tareasEtiquetas.tareaId, tareaId));
    expect(relacionesTarea).toHaveLength(0);

    const tareaProyectoId = await crearTarea(cookie, proyectoId, "Otra tarea");
    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaProyectoId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaId] },
    });

    await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyectoId}`,
      headers: { cookie: `sesion=${cookie}` },
    });

    const relacionesProyecto = await db
      .select()
      .from(schema.tareasEtiquetas)
      .where(eq(schema.tareasEtiquetas.tareaId, tareaProyectoId));
    expect(relacionesProyecto).toHaveLength(0);

    const etiquetasProyecto = await db
      .select()
      .from(schema.etiquetas)
      .where(eq(schema.etiquetas.id, etiquetaId));
    expect(etiquetasProyecto).toHaveLength(0);
  });

  it("aisla las etiquetas y tareas entre usuarios", async () => {
    const alice = await registrar(app, "alice");
    const bob = await registrar(app, "bob");

    const proyectoId = await crearProyecto(alice.cookie, "Proyecto de Alice");
    const tareaId = await crearTarea(alice.cookie, proyectoId, "Tarea de Alice");
    const etiquetaId = await crearEtiqueta(alice.cookie, proyectoId, "De Alice", "#6E4FE6");

    const getListado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(getListado.statusCode).toBe(404);

    const postAjeno = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/etiquetas`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { nombre: "Intrusa", color: "#6E4FE6" },
    });
    expect(postAjeno.statusCode).toBe(404);

    const patchAjeno = await app.inject({
      method: "PATCH",
      url: `/etiquetas/${etiquetaId}`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { nombre: "Intrusa" },
    });
    expect(patchAjeno.statusCode).toBe(404);

    const deleteAjeno = await app.inject({
      method: "DELETE",
      url: `/etiquetas/${etiquetaId}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(deleteAjeno.statusCode).toBe(404);

    const putAjeno = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { ids: [etiquetaId] },
    });
    expect(putAjeno.statusCode).toBe(404);
  });

  it("con token, cambiar etiquetas no ensucia la actividad y deja el historial", async () => {
    const { cookie } = await registrar(app, "token");
    const proyectoId = await crearProyecto(cookie, "Proyecto con token");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con token");
    const etiquetaId = await crearEtiqueta(cookie, proyectoId, "Con token", "#2563D9");
    const token = await crearToken(cookie);

    const cambio = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: [etiquetaId] },
    });
    expect(cambio.statusCode).toBe(200);

    const actividad = await app.inject({
      method: "GET",
      url: "/actividad",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(actividad.json()).toEqual([]);

    const historial = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/actividad`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const entradas = (historial.json() as { elementos: Array<Record<string, unknown>> }).elementos;
    expect(entradas.find((entrada) => entrada.historialTipo === "etiqueta")).toMatchObject({
      accion: "añadida",
      etiquetaId,
    });
  });
});
