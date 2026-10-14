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
  const email = `usuario-${sufijo}@example.com`;
  const respuesta = await app.inject({
    method: "POST",
    url: "/auth/registro",
    payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
  });
  return { cookie: obtenerCookieSesion(respuesta), email };
}

describe("proyectos y tareas", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    app = await buildApp(db as unknown as Database);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("exige sesión en las rutas principales", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const rutas = [
      { method: "GET", url: "/proyectos" },
      { method: "POST", url: "/proyectos" },
      { method: "GET", url: `/proyectos/${id}` },
      { method: "GET", url: `/proyectos/${id}/tareas` },
      { method: "GET", url: `/tareas/${id}` },
    ] as const;

    for (const ruta of rutas) {
      const respuesta = await app.inject({ method: ruta.method, url: ruta.url });
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("crea, lista, consulta, edita y borra un proyecto", async () => {
    const { cookie } = await registrar(app, "proyecto");
    const creacion = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Mi proyecto", descripcion: "Descripción" },
    });
    expect(creacion.statusCode).toBe(201);
    const proyecto = creacion.json() as {
      id: string;
      nombre: string;
      descripcion: string;
      updatedAt: string;
    };
    expect(proyecto.nombre).toBe("Mi proyecto");
    expect(proyecto.descripcion).toBe("Descripción");

    const listado = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(listado.statusCode).toBe(200);
    expect(listado.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: proyecto.id })]),
    );

    const consulta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(consulta.statusCode).toBe(200);
    expect(consulta.json()).toMatchObject({ id: proyecto.id, nombre: "Mi proyecto" });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const edicion = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Proyecto editado" },
    });
    expect(edicion.statusCode).toBe(200);
    const editado = edicion.json() as { nombre: string; updatedAt: string };
    expect(editado.nombre).toBe("Proyecto editado");
    expect(new Date(editado.updatedAt).getTime()).toBeGreaterThan(
      new Date(proyecto.updatedAt).getTime(),
    );

    const borrado = await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const despues = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(despues.statusCode).toBe(404);
  });

  it("crea y gestiona tareas dentro de un proyecto", async () => {
    const { cookie } = await registrar(app, "tareas");
    const proyectoResp = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Proyecto de tareas" },
    });
    const proyecto = proyectoResp.json() as { id: string };

    const creacion = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: {
        titulo: "Primera tarea",
        descripcion: "Detalle",
        venceEn: "2026-12-31T10:00:00.000Z",
      },
    });
    expect(creacion.statusCode).toBe(201);
    const tarea = creacion.json() as {
      id: string;
      titulo: string;
      estado: string;
      venceEn: string;
    };
    expect(tarea.titulo).toBe("Primera tarea");
    expect(tarea.estado).toBe("pendiente");
    expect(tarea.venceEn).toBe("2026-12-31T10:00:00.000Z");

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(listado.statusCode).toBe(200);
    expect(listado.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tarea.id })]),
    );

    const consulta = await app.inject({
      method: "GET",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(consulta.statusCode).toBe(200);
    expect(consulta.json()).toMatchObject({ id: tarea.id, titulo: "Primera tarea" });

    const edicion = await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Tarea editada", estado: "en_curso" },
    });
    expect(edicion.statusCode).toBe(200);
    expect(edicion.json()).toMatchObject({ titulo: "Tarea editada", estado: "en_curso" });

    const borrado = await app.inject({
      method: "DELETE",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const despues = await app.inject({
      method: "GET",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(despues.statusCode).toBe(404);
  });

  it("aisla los recursos entre usuarios distintos", async () => {
    const alice = await registrar(app, "alice");
    const bob = await registrar(app, "bob");

    const proyectoResp = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { nombre: "Proyecto de Alice" },
    });
    const proyecto = proyectoResp.json() as { id: string };

    const tareaResp = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { titulo: "Tarea de Alice" },
    });
    const tarea = tareaResp.json() as { id: string };

    const getProyecto = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(getProyecto.statusCode).toBe(404);

    const patchProyecto = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { nombre: "Intruso" },
    });
    expect(patchProyecto.statusCode).toBe(404);

    const deleteProyecto = await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(deleteProyecto.statusCode).toBe(404);

    const creacionAjena = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { titulo: "Intrusa" },
    });
    expect(creacionAjena.statusCode).toBe(404);

    const getTarea = await app.inject({
      method: "GET",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(getTarea.statusCode).toBe(404);

    const patchTarea = await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { titulo: "Intrusa" },
    });
    expect(patchTarea.statusCode).toBe(404);

    const deleteTarea = await app.inject({
      method: "DELETE",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(deleteTarea.statusCode).toBe(404);
  });

  it("valida los datos de entrada y los identificadores", async () => {
    const { cookie } = await registrar(app, "validacion");

    const vacio = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "" },
    });
    expect(vacio.statusCode).toBe(400);

    const estadoInvalido = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Válido" },
    });
    const proyecto = estadoInvalido.json() as { id: string };

    const estado = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Tarea", estado: "inexistente" },
    });
    expect(estado.statusCode).toBe(400);

    const noUuidProyecto = await app.inject({
      method: "GET",
      url: "/proyectos/no-es-uuid",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(noUuidProyecto.statusCode).toBe(400);

    const noUuidTarea = await app.inject({
      method: "GET",
      url: "/tareas/no-es-uuid",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(noUuidTarea.statusCode).toBe(400);
  });

  it("borra un proyecto y sus tareas en cascada", async () => {
    const { cookie } = await registrar(app, "cascada");
    const proyectoResp = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Proyecto cascada" },
    });
    const proyecto = proyectoResp.json() as { id: string };

    const tareaResp = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Tarea cascada" },
    });
    const tarea = tareaResp.json() as { id: string };

    const borrado = await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const tareaDespues = await app.inject({
      method: "GET",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(tareaDespues.statusCode).toBe(404);
  });
});
