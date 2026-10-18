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
  const email = `checklist-${sufijo}@example.com`;
  const respuesta = await app.inject({
    method: "POST",
    url: "/auth/registro",
    payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
  });
  return { cookie: obtenerCookieSesion(respuesta), email };
}

describe("checklist por tarea", () => {
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

  async function crearElemento(cookie: string, tareaId: string, texto: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function listar(
    cookie: string,
    tareaId: string,
  ): Promise<Array<{ id: string; texto: string; hecho: boolean; posicion: number }>> {
    const respuesta = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as Array<{
      id: string;
      texto: string;
      hecho: boolean;
      posicion: number;
    }>;
  }

  it("exige sesión en las rutas de checklist", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const rutas = [
      { method: "GET", url: `/tareas/${id}/checklist` },
      { method: "POST", url: `/tareas/${id}/checklist` },
      { method: "PATCH", url: `/checklist/${id}` },
      { method: "DELETE", url: `/checklist/${id}` },
    ] as const;

    for (const ruta of rutas) {
      const respuesta = await app.inject({ method: ruta.method, url: ruta.url });
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("crea, lista, edita y borra elementos reindexando", async () => {
    const { cookie } = await registrar(app, "crud");
    const proyectoId = await crearProyecto(cookie, "Proyecto con checklist");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea con pasos");

    const primero = await crearElemento(cookie, tareaId, "Primer paso");
    const segundo = await crearElemento(cookie, tareaId, "Segundo paso");

    const inicial = await listar(cookie, tareaId);
    expect(inicial).toHaveLength(2);
    expect(inicial[0]).toMatchObject({
      id: primero,
      texto: "Primer paso",
      hecho: false,
      posicion: 0,
    });
    expect(inicial[1]).toMatchObject({ id: segundo, texto: "Segundo paso", posicion: 1 });

    const marcado = await app.inject({
      method: "PATCH",
      url: `/checklist/${primero}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { hecho: true },
    });
    expect(marcado.statusCode).toBe(200);
    expect(marcado.json()).toMatchObject({ id: primero, hecho: true, posicion: 0 });

    const renombrado = await app.inject({
      method: "PATCH",
      url: `/checklist/${segundo}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Paso renombrado" },
    });
    expect(renombrado.statusCode).toBe(200);
    expect(renombrado.json()).toMatchObject({ texto: "Paso renombrado" });

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect((detalle.json() as { checklist: { hechos: number; total: number } }).checklist).toEqual({
      hechos: 1,
      total: 2,
    });

    const borrado = await app.inject({
      method: "DELETE",
      url: `/checklist/${primero}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const restante = await listar(cookie, tareaId);
    expect(restante).toHaveLength(1);
    expect(restante[0]).toMatchObject({ id: segundo, posicion: 0 });

    const borradoUltimo = await app.inject({
      method: "DELETE",
      url: `/checklist/${segundo}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borradoUltimo.statusCode).toBe(204);

    expect(await listar(cookie, tareaId)).toEqual([]);
  });

  it("valida el texto vacío o de más de 300 caracteres", async () => {
    const { cookie } = await registrar(app, "validacion");
    const proyectoId = await crearProyecto(cookie, "Proyecto validación checklist");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea validación");

    const vacio = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "" },
    });
    expect(vacio.statusCode).toBe(400);

    const soloEspacios = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "   " },
    });
    expect(soloEspacios.statusCode).toBe(400);

    const largo = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "a".repeat(301) },
    });
    expect(largo.statusCode).toBe(400);

    const limite = await crearElemento(cookie, tareaId, "a".repeat(300));
    const limiteOk = await listar(cookie, tareaId);
    expect(limiteOk[0]).toMatchObject({ id: limite, texto: "a".repeat(300) });

    const patchVacio = await app.inject({
      method: "PATCH",
      url: `/checklist/${limite}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "  " },
    });
    expect(patchVacio.statusCode).toBe(400);

    const patchLargo = await app.inject({
      method: "PATCH",
      url: `/checklist/${limite}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "b".repeat(301) },
    });
    expect(patchLargo.statusCode).toBe(400);
  });

  it("reordena el elemento y reindexa sin huecos ni duplicados", async () => {
    const { cookie } = await registrar(app, "reordenar");
    const proyectoId = await crearProyecto(cookie, "Proyecto reordenar");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea reordenar");

    const a = await crearElemento(cookie, tareaId, "A");
    const b = await crearElemento(cookie, tareaId, "B");
    const c = await crearElemento(cookie, tareaId, "C");
    const d = await crearElemento(cookie, tareaId, "D");

    const moverArriba = await app.inject({
      method: "PATCH",
      url: `/checklist/${d}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 0 },
    });
    expect(moverArriba.statusCode).toBe(200);
    expect((moverArriba.json() as { posicion: number }).posicion).toBe(0);

    let lista = await listar(cookie, tareaId);
    expect(lista.map((elemento) => elemento.id)).toEqual([d, a, b, c]);
    expect(lista.map((elemento) => elemento.posicion)).toEqual([0, 1, 2, 3]);

    const moverAbajo = await app.inject({
      method: "PATCH",
      url: `/checklist/${a}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 3 },
    });
    expect(moverAbajo.statusCode).toBe(200);

    lista = await listar(cookie, tareaId);
    expect(lista.map((elemento) => elemento.id)).toEqual([d, b, c, a]);
    expect(lista.map((elemento) => elemento.posicion)).toEqual([0, 1, 2, 3]);

    // Una posición fuera de rango se ajusta al final sin duplicar ni dejar huecos.
    const moverFueraDeRango = await app.inject({
      method: "PATCH",
      url: `/checklist/${b}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 99 },
    });
    expect(moverFueraDeRango.statusCode).toBe(200);

    lista = await listar(cookie, tareaId);
    expect(lista.map((elemento) => elemento.id)).toEqual([d, c, a, b]);
    expect(lista.map((elemento) => elemento.posicion)).toEqual([0, 1, 2, 3]);

    // Solo hay un elemento por posición.
    expect(new Set(lista.map((elemento) => elemento.posicion)).size).toBe(lista.length);
  });

  it("limita el checklist a 200 elementos", async () => {
    const { cookie } = await registrar(app, "limite");
    const proyectoId = await crearProyecto(cookie, "Proyecto límite");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea límite");

    await db.insert(schema.checklistItems).values(
      Array.from({ length: 199 }, (_valor, indice) => ({
        tareaId,
        texto: `Paso ${indice}`,
        posicion: indice,
      })),
    );

    const ultimoValido = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Paso 199" },
    });
    expect(ultimoValido.statusCode).toBe(201);

    const desbordado = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Paso 200" },
    });
    expect(desbordado.statusCode).toBe(400);

    const lista = await listar(cookie, tareaId);
    expect(lista).toHaveLength(200);
    expect(lista[199]?.texto).toBe("Paso 199");
  });

  it("resume {hechos, total} en el listado de tareas del proyecto", async () => {
    const { cookie } = await registrar(app, "resumen");
    const proyectoId = await crearProyecto(cookie, "Proyecto resumen");
    const tareaConPasos = await crearTarea(cookie, proyectoId, "Tarea con pasos");
    const tareaVacia = await crearTarea(cookie, proyectoId, "Tarea sin pasos");

    const primero = await crearElemento(cookie, tareaConPasos, "Uno");
    const segundo = await crearElemento(cookie, tareaConPasos, "Dos");
    const tercero = await crearElemento(cookie, tareaConPasos, "Tres");

    await app.inject({
      method: "PATCH",
      url: `/checklist/${primero}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { hecho: true },
    });

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(listado.statusCode).toBe(200);
    const tareas = listado.json() as Array<{
      id: string;
      etiquetas: string[];
      checklist: {
        hechos: number;
        total: number;
        items: Array<{ id: string; texto: string; hecho: boolean }>;
      };
    }>;

    expect(tareas.find((tarea) => tarea.id === tareaConPasos)?.checklist).toEqual({
      hechos: 1,
      total: 3,
      items: [
        { id: primero, texto: "Uno", hecho: true },
        { id: segundo, texto: "Dos", hecho: false },
        { id: tercero, texto: "Tres", hecho: false },
      ],
    });
    expect(tareas.find((tarea) => tarea.id === tareaVacia)?.checklist).toEqual({
      hechos: 0,
      total: 0,
      items: [],
    });

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${tareaVacia}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect((detalle.json() as { checklist: { hechos: number; total: number } }).checklist).toEqual({
      hechos: 0,
      total: 0,
    });
  });

  it("devuelve los elementos ordenados por posición y solo de sus tareas", async () => {
    const { cookie } = await registrar(app, "items");
    const proyectoId = await crearProyecto(cookie, "Proyecto items");
    const tareaA = await crearTarea(cookie, proyectoId, "Tarea A");
    const tareaB = await crearTarea(cookie, proyectoId, "Tarea B");

    const uno = await crearElemento(cookie, tareaA, "Uno");
    const dos = await crearElemento(cookie, tareaA, "Dos");
    const deB = await crearElemento(cookie, tareaB, "De B");

    // Otro proyecto del mismo usuario: sus elementos no deben colarse.
    const otroProyecto = await crearProyecto(cookie, "Proyecto ajeno al listado");
    const tareaOtro = await crearTarea(cookie, otroProyecto, "Tarea de otro proyecto");
    const elementoOtro = await crearElemento(cookie, tareaOtro, "No debe aparecer");

    // «Dos» pasa al primer puesto: el listado debe respetar la posición.
    await app.inject({
      method: "PATCH",
      url: `/checklist/${dos}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 0 },
    });

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(listado.statusCode).toBe(200);
    const tareas = listado.json() as Array<{
      id: string;
      checklist: { items: Array<{ id: string; texto: string; hecho: boolean }> };
    }>;

    expect(tareas.map((tarea) => tarea.id).sort()).toEqual([tareaA, tareaB].sort());
    expect(tareas.find((tarea) => tarea.id === tareaA)?.checklist.items).toEqual([
      { id: dos, texto: "Dos", hecho: false },
      { id: uno, texto: "Uno", hecho: false },
    ]);
    expect(tareas.find((tarea) => tarea.id === tareaB)?.checklist.items).toEqual([
      { id: deB, texto: "De B", hecho: false },
    ]);
    expect(tareas.flatMap((tarea) => tarea.checklist.items.map((item) => item.id))).not.toContain(
      elementoOtro,
    );
  });

  it("borrar la tarea borra sus elementos", async () => {
    const { cookie } = await registrar(app, "cascada");
    const proyectoId = await crearProyecto(cookie, "Proyecto cascada checklist");
    const tareaId = await crearTarea(cookie, proyectoId, "Tarea cascada");
    await crearElemento(cookie, tareaId, "Paso efímero");

    const borrado = await app.inject({
      method: "DELETE",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const restantes = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.tareaId, tareaId));
    expect(restantes).toHaveLength(0);
  });

  it("aisla el checklist entre usuarios", async () => {
    const alice = await registrar(app, "alice");
    const bob = await registrar(app, "bob");

    const proyectoId = await crearProyecto(alice.cookie, "Proyecto de Alice");
    const tareaId = await crearTarea(alice.cookie, proyectoId, "Tarea de Alice");
    const elementoId = await crearElemento(alice.cookie, tareaId, "Paso de Alice");

    const getAjeno = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(getAjeno.statusCode).toBe(404);

    const postAjeno = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { texto: "Intrusa" },
    });
    expect(postAjeno.statusCode).toBe(404);

    const patchAjeno = await app.inject({
      method: "PATCH",
      url: `/checklist/${elementoId}`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { hecho: true },
    });
    expect(patchAjeno.statusCode).toBe(404);

    const deleteAjeno = await app.inject({
      method: "DELETE",
      url: `/checklist/${elementoId}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(deleteAjeno.statusCode).toBe(404);

    const lista = await listar(alice.cookie, tareaId);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.hecho).toBe(false);
  });
});
