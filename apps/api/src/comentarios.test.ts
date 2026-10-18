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

interface ElementoActividad {
  tipo: string;
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
  texto?: string;
  historialTipo?: string;
}

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("comentarios de tarea", () => {
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

  async function registrar(
    sufijo: string,
  ): Promise<{ cookie: string; email: string; usuarioId: string }> {
    const email = `comentarios-${sufijo}@example.com`;
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
    });
    const [usuario] = await db
      .select({ id: schema.usuarios.id })
      .from(schema.usuarios)
      .where(eq(schema.usuarios.email, email))
      .limit(1);
    return { cookie: obtenerCookieSesion(respuesta), email, usuarioId: usuario!.id };
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

  async function comentar(
    cookie: string,
    tareaId: string,
    texto: string,
  ): Promise<{ statusCode: number; id: string; texto: string }> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/comentarios`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto },
    });
    return {
      statusCode: respuesta.statusCode,
      id: (respuesta.json() as { id: string }).id,
      texto: (respuesta.json() as { texto: string }).texto,
    };
  }

  async function actividad(cookie: string, tareaId: string, pagina?: number) {
    const url = pagina
      ? `/tareas/${tareaId}/actividad?pagina=${pagina}`
      : `/tareas/${tareaId}/actividad`;
    return app.inject({ method: "GET", url, headers: { cookie: `sesion=${cookie}` } });
  }

  it("exige sesión en las rutas de comentarios", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const rutas = [
      { method: "POST", url: `/tareas/${id}/comentarios` },
      { method: "PATCH", url: `/comentarios/${id}` },
      { method: "DELETE", url: `/comentarios/${id}` },
    ] as const;

    for (const ruta of rutas) {
      const respuesta = await app.inject({ method: ruta.method, url: ruta.url });
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("crea, edita y borra el comentario propio", async () => {
    const { cookie, usuarioId } = await registrar("crud");
    const proyectoId = await crearProyecto(cookie, "Proyecto comentarios");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea comentada");

    const creado = await comentar(cookie, tareaId, "  Primer comentario  ");
    expect(creado.statusCode).toBe(201);
    expect(creado.texto).toBe("Primer comentario");

    const listado = await actividad(cookie, tareaId);
    expect(listado.statusCode).toBe(200);
    const cuerpo = listado.json() as { elementos: ElementoActividad[]; hayMas: boolean };
    const comentario = cuerpo.elementos.find((elemento) => elemento.tipo === "comentario");
    expect(comentario).toMatchObject({
      tipo: "comentario",
      id: creado.id,
      usuarioId,
      usuarioNombre: "Usuario crud",
      texto: "Primer comentario",
    });
    expect(typeof comentario?.creadoEn).toBe("string");

    const edicion = await app.inject({
      method: "PATCH",
      url: `/comentarios/${creado.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Comentario editado" },
    });
    expect(edicion.statusCode).toBe(200);
    expect(edicion.json()).toMatchObject({ id: creado.id, texto: "Comentario editado" });

    const borrado = await app.inject({
      method: "DELETE",
      url: `/comentarios/${creado.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const despues = await actividad(cookie, tareaId);
    const elementos = (despues.json() as { elementos: ElementoActividad[] }).elementos;
    expect(elementos.filter((elemento) => elemento.tipo === "comentario")).toHaveLength(0);
  });

  it("valida texto vacío, solo espacios o demasiado largo", async () => {
    const { cookie } = await registrar("validacion");
    const proyectoId = await crearProyecto(cookie, "Proyecto validación comentarios");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea validación");

    for (const texto of ["", "   ", "x".repeat(5001)]) {
      const respuesta = await app.inject({
        method: "POST",
        url: `/tareas/${tareaId}/comentarios`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { texto },
      });
      expect(respuesta.statusCode).toBe(400);
    }

    const maximo = await comentar(cookie, tareaId, "x".repeat(5000));
    expect(maximo.statusCode).toBe(201);

    const patchVacio = await app.inject({
      method: "PATCH",
      url: `/comentarios/${maximo.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "   " },
    });
    expect(patchVacio.statusCode).toBe(400);
  });

  it("solo el autor edita o borra, aunque sea el dueño del proyecto", async () => {
    const alice = await registrar("alice-autor");
    const bob = await registrar("bob-autor");
    const proyectoId = await crearProyecto(alice.cookie, "Proyecto autoría");
    const tareaId = await crearTarea(alice.cookie, proyectoId, "Tarea autoría");

    // Comentario de Bob insertado directamente: no hay forma de que otro
    // usuario comente en una tarea ajena a través de la API.
    const [ajeno] = await db
      .insert(schema.comentarios)
      .values({ tareaId, usuarioId: bob.usuarioId, texto: "De Bob" })
      .returning();

    const patchPorDueno = await app.inject({
      method: "PATCH",
      url: `/comentarios/${ajeno!.id}`,
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { texto: "Intruso" },
    });
    expect(patchPorDueno.statusCode).toBe(404);

    const deletePorDueno = await app.inject({
      method: "DELETE",
      url: `/comentarios/${ajeno!.id}`,
      headers: { cookie: `sesion=${alice.cookie}` },
    });
    expect(deletePorDueno.statusCode).toBe(404);

    const patchPorOtro = await app.inject({
      method: "PATCH",
      url: `/comentarios/${ajeno!.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { texto: "Intruso" },
    });
    expect(patchPorOtro.statusCode).toBe(404);

    const patchInexistente = await app.inject({
      method: "PATCH",
      url: "/comentarios/11111111-1111-4111-8111-111111111111",
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { texto: "Nada" },
    });
    expect(patchInexistente.statusCode).toBe(404);
  });

  it("aísla las tareas y comentarios entre usuarios", async () => {
    const alice = await registrar("alice-aisla");
    const bob = await registrar("bob-aisla");
    const proyectoId = await crearProyecto(alice.cookie, "Proyecto privado");
    const tareaId = await crearTarea(alice.cookie, proyectoId, "Tarea privada");
    await comentar(alice.cookie, tareaId, "Solo de Alice");

    const postAjeno = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/comentarios`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { texto: "Intruso" },
    });
    expect(postAjeno.statusCode).toBe(404);

    const getAjeno = await actividad(bob.cookie, tareaId);
    expect(getAjeno.statusCode).toBe(404);

    const tareaInexistente = await comentar(
      alice.cookie,
      "11111111-1111-4111-8111-111111111111",
      "Nada",
    );
    expect(tareaInexistente.statusCode).toBe(404);
  });

  it("devuelve el recuento de comentarios en listado y detalle", async () => {
    const { cookie } = await registrar("recuento");
    const proyectoId = await crearProyecto(cookie, "Proyecto recuento");
    const conComentarios = await crearTarea(cookie, proyectoId, "Con comentarios");
    const sinComentarios = await crearTarea(cookie, proyectoId, "Sin comentarios");

    await comentar(cookie, conComentarios, "Uno");
    await comentar(cookie, conComentarios, "Dos");

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const tareas = listado.json() as Array<{ id: string; comentarios: number }>;
    expect(tareas.find((tarea) => tarea.id === conComentarios)?.comentarios).toBe(2);
    expect(tareas.find((tarea) => tarea.id === sinComentarios)?.comentarios).toBe(0);

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${conComentarios}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect((detalle.json() as { comentarios: number }).comentarios).toBe(2);
  });
});
