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
      email: `columnas-${sufijo}@example.com`,
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
  return respuesta.json() as { id: string };
}

describe("columnas y tareas", () => {
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

  it("crea las columnas por defecto al crear un proyecto", async () => {
    const { cookie } = await registrar(app, "defecto");
    const proyecto = await crearProyecto(app, cookie);

    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });

    expect(respuesta.statusCode).toBe(200);
    const columnas = respuesta.json() as Array<{ nombre: string; posicion: number }>;
    expect(columnas.map((c) => c.nombre)).toEqual(["Pendiente", "En curso", "Hecha"]);
    expect(columnas.map((c) => c.posicion)).toEqual([0, 1, 2]);
  });

  it("gestiona columnas: crear, renombrar y reordenar", async () => {
    const { cookie } = await registrar(app, "crud");
    const proyecto = await crearProyecto(app, cookie);

    const creada = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Extra" },
    });
    expect(creada.statusCode).toBe(201);
    const columnaExtra = creada.json() as { id: string; nombre: string; posicion: number };
    expect(columnaExtra.nombre).toBe("Extra");
    expect(columnaExtra.posicion).toBe(3);

    const renombrada = await app.inject({
      method: "PATCH",
      url: `/columnas/${columnaExtra.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Renombrada" },
    });
    expect(renombrada.statusCode).toBe(200);
    expect(renombrada.json()).toMatchObject({ id: columnaExtra.id, nombre: "Renombrada" });

    const reordenada = await app.inject({
      method: "PATCH",
      url: `/columnas/${columnaExtra.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 0 },
    });
    expect(reordenada.statusCode).toBe(200);

    const listado = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const columnas = listado.json() as Array<{ id: string; nombre: string; posicion: number }>;
    expect(columnas.map((c) => c.posicion)).toEqual([0, 1, 2, 3]);
    expect(new Set(columnas.map((c) => c.posicion)).size).toBe(columnas.length);
    expect(columnas[0]!.id).toBe(columnaExtra.id);
  });

  it("aisla las columnas entre usuarios", async () => {
    const alice = await registrar(app, "alice-columnas");
    const bob = await registrar(app, "bob-columnas");
    const proyecto = await crearProyecto(app, alice.cookie);

    const [columna] = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyecto.id}/columnas`,
        headers: { cookie: `sesion=${alice.cookie}` },
      })
    ).json() as [{ id: string }];

    const get = await app.inject({
      method: "GET",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(get.statusCode).toBe(404);

    const patch = await app.inject({
      method: "PATCH",
      url: `/columnas/${columna.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { nombre: "Intrusa" },
    });
    expect(patch.statusCode).toBe(404);

    const borrar = await app.inject({
      method: "DELETE",
      url: `/columnas/${columna.id}`,
      headers: { cookie: `sesion=${bob.cookie}` },
    });
    expect(borrar.statusCode).toBe(404);
  });

  it("borra columnas vacías y compacta; protege columna con tareas y la última", async () => {
    const { cookie } = await registrar(app, "borrado-columnas");
    const proyecto = await crearProyecto(app, cookie);

    const tarea = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Tarea en columna" },
    });
    expect(tarea.statusCode).toBe(201);
    const columnasAntes = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyecto.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; nombre: string; posicion: number }>;
    const columnaConTarea = columnasAntes[0]!;

    const conTareas = await app.inject({
      method: "DELETE",
      url: `/columnas/${columnaConTarea.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(conTareas.statusCode).toBe(409);

    const proyectoLimpio = await crearProyecto(app, cookie, "Proyecto limpio");
    const columnasIniciales = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyectoLimpio.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; posicion: number }>;

    const primerBorrado = await app.inject({
      method: "DELETE",
      url: `/columnas/${columnasIniciales[0]!.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(primerBorrado.statusCode).toBe(204);

    const despues = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyectoLimpio.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; posicion: number }>;
    expect(despues.map((c) => c.posicion)).toEqual([0, 1]);

    const segundoBorrado = await app.inject({
      method: "DELETE",
      url: `/columnas/${despues[0]!.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(segundoBorrado.statusCode).toBe(204);

    const restantes = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyectoLimpio.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; posicion: number }>;
    expect(restantes).toHaveLength(1);

    const ultimo = await app.inject({
      method: "DELETE",
      url: `/columnas/${restantes[0]!.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(ultimo.statusCode).toBe(409);
  });

  it("crea tareas con columna por defecto o columna explícita validada", async () => {
    const { cookie } = await registrar(app, "tareas-columna");
    const proyectoA = await crearProyecto(app, cookie, "Proyecto A");
    const proyectoB = await crearProyecto(app, cookie, "Proyecto B");

    const columnasB = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyectoB.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string }>;
    const columnaAjena = columnasB[0]!.id;

    const invalida = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoA.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Inválida", columnaId: columnaAjena },
    });
    expect(invalida.statusCode).toBe(400);

    const primera = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyectoA.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; posicion: number }>;

    const creada = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoA.id}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo: "Por defecto" },
    });
    expect(creada.statusCode).toBe(201);
    const tarea = creada.json() as { id: string; columnaId: string; posicion: number };
    expect(tarea.columnaId).toBe(primera[0]!.id);
    expect(tarea.posicion).toBe(0);
  });

  it("mueve y reordena tareas entre columnas y compacta al borrar", async () => {
    const { cookie } = await registrar(app, "movimiento");
    const proyecto = await crearProyecto(app, cookie);

    const columnasProyecto = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyecto.id}/columnas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; nombre: string; posicion: number }>;
    const columnaOrigen = columnasProyecto[0]!;
    const columnaDestino = columnasProyecto[1]!;

    const tareaA = (
      await app.inject({
        method: "POST",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { titulo: "Tarea A", columnaId: columnaOrigen.id },
      })
    ).json() as { id: string };
    const tareaB = (
      await app.inject({
        method: "POST",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { titulo: "Tarea B", columnaId: columnaOrigen.id },
      })
    ).json() as { id: string };
    const tareaC = (
      await app.inject({
        method: "POST",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { titulo: "Tarea C", columnaId: columnaDestino.id },
      })
    ).json() as { id: string };

    const movimiento = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaB.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { columnaId: columnaDestino.id, posicion: 0 },
    });
    expect(movimiento.statusCode).toBe(200);

    const origen = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; columnaId: string; posicion: number }>;

    const tareasOrigen = origen.filter((t) => t.columnaId === columnaOrigen.id);
    const tareasDestino = origen.filter((t) => t.columnaId === columnaDestino.id);
    expect(tareasOrigen.map((t) => t.id)).toEqual([tareaA.id]);
    expect(tareasOrigen.map((t) => t.posicion)).toEqual([0]!);
    expect(tareasDestino.map((t) => t.id)).toEqual([tareaB.id, tareaC.id]);
    expect(tareasDestino.map((t) => t.posicion)).toEqual([0, 1]);

    await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaA.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 0 },
    }); // tarea A ya está en posición 0, pero forzamos reordenación con otra tarea nueva
    const tareaD = (
      await app.inject({
        method: "POST",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { titulo: "Tarea D", columnaId: columnaOrigen.id },
      })
    ).json() as { id: string };

    const intercambio = await app.inject({
      method: "PATCH",
      url: `/tareas/${tareaD.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { posicion: 0 },
    });
    expect(intercambio.statusCode).toBe(200);

    const trasReorden = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; columnaId: string; posicion: number }>;
    const mismoOrigen = trasReorden.filter((t) => t.columnaId === columnaOrigen.id);
    expect(mismoOrigen.map((t) => t.posicion)).toEqual([0, 1]);
    expect(new Set(mismoOrigen.map((t) => t.posicion)).size).toBe(mismoOrigen.length);

    const borrado = await app.inject({
      method: "DELETE",
      url: `/tareas/${tareaA.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrado.statusCode).toBe(204);

    const trasBorrado = (
      await app.inject({
        method: "GET",
        url: `/proyectos/${proyecto.id}/tareas`,
        headers: { cookie: `sesion=${cookie}` },
      })
    ).json() as Array<{ id: string; columnaId: string; posicion: number }>;
    const restantes = trasBorrado.filter((t) => t.columnaId === columnaOrigen.id);
    expect(restantes.map((t) => t.posicion)).toEqual([0]!);
  });
});
