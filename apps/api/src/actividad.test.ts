import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import { tokensApi, tareas } from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("actividad del conector", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let contador = 0;

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
      sql`truncate table actividad, tokens_api, ocurrencias_hechas, avisos_enviados, suscripciones_push, tareas, columnas, proyectos, usuarios restart identity cascade`,
    );
  });

  async function registrar(): Promise<string> {
    contador += 1;
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `actividad-${contador}@example.com`,
        nombre: `Usuario ${contador}`,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  async function crearToken(cookie: string, permiso: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Conector", permiso },
    });
    return (respuesta.json() as { token: string }).token;
  }

  async function crearProyecto(cookie: string) {
    const respuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Proyecto" },
    });
    const proyecto = respuesta.json() as { id: string };
    const columnasRespuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const columnas = columnasRespuesta.json() as Array<{ id: string; nombre: string }>;
    return { id: proyecto.id, columnas };
  }

  function conToken(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function listarActividad(cookie: string, limite?: number) {
    const respuesta = await app.inject({
      method: "GET",
      url: limite ? `/actividad?limite=${limite}` : "/actividad",
      headers: { cookie: `sesion=${cookie}` },
    });
    return respuesta.json() as Array<{
      id: string;
      accion: string;
      titulo: string | null;
      tokenNombre: string | null;
      deshechoEn: string | null;
      antes: Record<string, unknown> | null;
      despues: Record<string, unknown> | null;
    }>;
  }

  async function crearTarea(
    token: string,
    proyectoId: string,
    columnaId: string,
    titulo: string,
  ): Promise<{ id: string }> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: conToken(token),
      payload: { titulo, columnaId },
    });
    return respuesta.json() as { id: string };
  }

  it("registra las acciones hechas con token y no las de sesión", async () => {
    const cookie = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);

    await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Con sesión", columnaId: proyecto.columnas[0]!.id },
    });

    const tarea = await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "Creada");

    const filas = await db.select().from(schema.actividad);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ accion: "crear", entidad: "tarea", entidadId: tarea.id });
    expect(filas[0]!.antes).toBeNull();
    expect(filas[0]!.tokenNombre).toBe("Conector");
  });

  it("registra editar, mover y borrar", async () => {
    const cookie = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);
    const [c1, c2] = proyecto.columnas;

    const tarea = await crearTarea(escritura, proyecto.id, c1!.id, "Tarea");

    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
      payload: { titulo: "Editada" },
    });

    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
      payload: { columnaId: c2!.id, posicion: 0 },
    });

    await app.inject({
      method: "DELETE",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
    });

    const acciones = (await db.select().from(schema.actividad)).map((fila) => fila.accion).sort();
    expect(acciones).toEqual(["borrar", "crear", "editar", "editar"]);
  });

  it("no registra un PATCH sin cambios reales", async () => {
    const cookie = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);
    const tarea = await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "Igual");

    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
      payload: { titulo: "Igual" },
    });

    const filas = await db.select().from(schema.actividad);
    expect(filas.map((fila) => fila.accion)).toEqual(["crear"]);
  });

  it("lista solo la actividad del usuario, con límite y orden", async () => {
    const cookie = await registrar();
    const otro = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);

    await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "A");
    await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "B");
    await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "C");

    const todas = await listarActividad(cookie);
    expect(todas).toHaveLength(3);
    expect(todas[0]!.titulo).toBe("C");
    expect(todas.map((fila) => fila.tokenNombre)).toEqual(["Conector", "Conector", "Conector"]);

    const limitada = await listarActividad(cookie, 2);
    expect(limitada).toHaveLength(2);

    const deOtro = await listarActividad(otro);
    expect(deOtro).toHaveLength(0);
  });

  it("deshace crear, editar, mover y borrar", async () => {
    const cookie = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);
    const [c1, c2] = proyecto.columnas;

    // deshacer crear
    const creada = await crearTarea(escritura, proyecto.id, c1!.id, "Para borrar");
    const [actividadCrear] = await listarActividad(cookie);
    const deshacerCrear = await app.inject({
      method: "POST",
      url: `/actividad/${actividadCrear!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(deshacerCrear.statusCode).toBe(204);
    expect(await db.select().from(tareas).where(eq(tareas.id, creada.id))).toHaveLength(0);

    // deshacer editar
    const tarea = await crearTarea(escritura, proyecto.id, c1!.id, "Original");
    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
      payload: { titulo: "Cambiada" },
    });
    const [actividadEditar] = await listarActividad(cookie);
    const deshacerEditar = await app.inject({
      method: "POST",
      url: `/actividad/${actividadEditar!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(deshacerEditar.statusCode).toBe(204);
    const [trasEditar] = await db.select().from(tareas).where(eq(tareas.id, tarea.id));
    expect(trasEditar!.titulo).toBe("Original");

    // deshacer mover entre columnas con reindexado
    const otra = await crearTarea(escritura, proyecto.id, c2!.id, "En destino");
    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
      payload: { columnaId: c2!.id, posicion: 0 },
    });
    const [actividadMover] = await listarActividad(cookie);
    const deshacerMover = await app.inject({
      method: "POST",
      url: `/actividad/${actividadMover!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(deshacerMover.statusCode).toBe(204);

    const enDestino = await db
      .select()
      .from(tareas)
      .where(eq(tareas.columnaId, c2!.id))
      .orderBy(tareas.posicion);
    expect(enDestino.map((fila) => fila.id)).toEqual([otra.id]);
    expect(enDestino.map((fila) => fila.posicion)).toEqual([0]);

    // deshacer borrar recrea con el mismo id
    await app.inject({
      method: "DELETE",
      url: `/tareas/${otra.id}`,
      headers: conToken(escritura),
    });
    const [actividadBorrar] = await listarActividad(cookie);
    const deshacerBorrar = await app.inject({
      method: "POST",
      url: `/actividad/${actividadBorrar!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(deshacerBorrar.statusCode).toBe(204);
    const [recreada] = await db.select().from(tareas).where(eq(tareas.id, otra.id));
    expect(recreada!.titulo).toBe("En destino");
  });

  it("detecta conflictos, repeticiones y actividad ajena", async () => {
    const cookie = await registrar();
    const otro = await registrar();
    const lectura = await crearToken(cookie, "lectura");
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);

    const tarea = await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "Original");
    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: conToken(escritura),
      payload: { titulo: "Con token" },
    });
    const [actividad] = await listarActividad(cookie);

    const ajena = await app.inject({
      method: "POST",
      url: `/actividad/${actividad!.id}/deshacer`,
      headers: { cookie: `sesion=${otro}` },
    });
    expect(ajena.statusCode).toBe(404);

    const conLectura = await app.inject({
      method: "POST",
      url: `/actividad/${actividad!.id}/deshacer`,
      headers: { authorization: `Bearer ${lectura}` },
    });
    expect(conLectura.statusCode).toBe(403);

    // Alguien cambia la tarea después: conflicto.
    await app.inject({
      method: "PATCH",
      url: `/tareas/${tarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Cambiada después" },
    });
    const conflicto = await app.inject({
      method: "POST",
      url: `/actividad/${actividad!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(conflicto.statusCode).toBe(409);
    expect(conflicto.json()).toMatchObject({ mensaje: expect.stringContaining("ha cambiado") });
  });

  it("no permite deshacer dos veces", async () => {
    const cookie = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);
    await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "Tarea");

    const [actividad] = await listarActividad(cookie);
    const primera = await app.inject({
      method: "POST",
      url: `/actividad/${actividad!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(primera.statusCode).toBe(204);

    const segunda = await app.inject({
      method: "POST",
      url: `/actividad/${actividad!.id}/deshacer`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json()).toMatchObject({ mensaje: "Ya está deshecho" });
  });

  it("conserva el nombre del token después de revocarlo o borrarlo", async () => {
    const cookie = await registrar();
    const escritura = await crearToken(cookie, "escritura");
    const proyecto = await crearProyecto(cookie);
    await crearTarea(escritura, proyecto.id, proyecto.columnas[0]!.id, "Tarea");

    const [tokenFila] = await db.select().from(tokensApi);
    await app.inject({
      method: "DELETE",
      url: `/tokens/${tokenFila!.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });

    const [trasRevocar] = await listarActividad(cookie);
    expect(trasRevocar!.tokenNombre).toBe("Conector");

    await db.delete(tokensApi).where(eq(tokensApi.id, tokenFila!.id));
    const [trasBorrar] = await listarActividad(cookie);
    expect(trasBorrar!.tokenNombre).toBe("Conector");
  });
});
