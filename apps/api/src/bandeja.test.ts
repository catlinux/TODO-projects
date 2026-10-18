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

interface ColumnaApi {
  id: string;
  nombre: string;
  posicion: number;
}

interface TareaApi {
  id: string;
  titulo: string;
  proyectoId: string;
  columnaId: string;
  posicion: number;
  etiquetas: string[];
  checklist: { hechos: number; total: number };
  comentarios: number;
  recurrencia: string | null;
}

interface ProyectoApi {
  id: string;
  nombre: string;
  color: string | null;
  esBandeja: boolean;
}

interface ElementoHistorial {
  tipo: string;
  historialTipo?: string;
  desdeProyectoId?: string;
  hastaProyectoId?: string;
  desde?: string;
  hasta?: string;
}

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("bandeja de entrada y mover entre proyectos", () => {
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
    const email = `bandeja-${sufijo}@example.com`;
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

  async function crearTarea(
    cookie: string,
    proyectoId: string,
    titulo: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { titulo, ...extra },
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function listarColumnas(cookie: string, proyectoId: string): Promise<ColumnaApi[]> {
    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as ColumnaApi[];
  }

  async function listarTareas(cookie: string, proyectoId: string): Promise<TareaApi[]> {
    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as TareaApi[];
  }

  async function obtenerBandeja(
    cookie: string,
  ): Promise<{ proyecto: ProyectoApi; columnas: ColumnaApi[]; tareas: TareaApi[] }> {
    const respuesta = await app.inject({
      method: "GET",
      url: "/bandeja",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as {
      proyecto: ProyectoApi;
      columnas: ColumnaApi[];
      tareas: TareaApi[];
    };
  }

  it("crea la bandeja una sola vez y la excluye de GET /proyectos", async () => {
    const { cookie } = await registrar("idempotente");

    const primera = await obtenerBandeja(cookie);
    expect(primera.proyecto.nombre).toBe("Bandeja de entrada");
    expect(primera.proyecto.esBandeja).toBe(true);
    expect(primera.columnas).toHaveLength(1);
    expect(primera.columnas[0]?.nombre).toBe("Entrada");
    expect(primera.tareas).toEqual([]);

    const segunda = await obtenerBandeja(cookie);
    expect(segunda.proyecto.id).toBe(primera.proyecto.id);

    const proyectos = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(proyectos.statusCode).toBe(200);
    const listado = proyectos.json() as ProyectoApi[];
    expect(listado.some((proyecto) => proyecto.id === primera.proyecto.id)).toBe(false);
    expect(listado.some((proyecto) => proyecto.esBandeja)).toBe(false);
  });

  it("devuelve sus tareas con etiquetas, checklist y comentarios", async () => {
    const { cookie } = await registrar("contenido");
    const { proyecto, columnas } = await obtenerBandeja(cookie);

    const tareaId = await crearTarea(cookie, proyecto.id, "Captura rápida", {
      descripcion: "Algo que apuntar",
    });

    const etiqueta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Entrada", color: "#0E7490" },
    });
    expect(etiqueta.statusCode).toBe(201);
    const etiquetaId = (etiqueta.json() as { id: string }).id;

    const asignar = await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaId] },
    });
    expect(asignar.statusCode).toBe(200);

    const checklist = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/checklist`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Paso uno" },
    });
    const elementoId = (checklist.json() as { id: string }).id;
    await app.inject({
      method: "PATCH",
      url: `/checklist/${elementoId}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { hecho: true },
    });

    await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/comentarios`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { texto: "Un comentario" },
    });

    const bandeja = await obtenerBandeja(cookie);
    expect(bandeja.tareas).toHaveLength(1);
    expect(bandeja.tareas[0]).toMatchObject({
      id: tareaId,
      columnaId: columnas[0]?.id,
      posicion: 0,
      etiquetas: [etiquetaId],
      checklist: { hechos: 1, total: 1 },
      comentarios: 1,
    });
  });

  it("no se puede renombrar, borrar ni ampliar con columnas", async () => {
    const { cookie } = await registrar("protegida");
    const { proyecto } = await obtenerBandeja(cookie);

    const renombrar = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Otra cosa" },
    });
    expect(renombrar.statusCode).toBe(400);

    const borrar = await app.inject({
      method: "DELETE",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(borrar.statusCode).toBe(409);

    const columnaExtra = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto.id}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Otra columna" },
    });
    expect(columnaExtra.statusCode).toBe(400);

    // El color y el fondo sí se pueden cambiar.
    const color = await app.inject({
      method: "PATCH",
      url: `/proyectos/${proyecto.id}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { color: "#5B5BD6" },
    });
    expect(color.statusCode).toBe(200);
    expect((color.json() as ProyectoApi).color).toBe("#5B5BD6");

    const bandeja = await obtenerBandeja(cookie);
    expect(bandeja.proyecto.id).toBe(proyecto.id);
    expect(bandeja.columnas).toHaveLength(1);
  });

  it("mueve la tarea al final del proyecto destino y le quita las etiquetas", async () => {
    const { cookie } = await registrar("mover");
    const origen = await crearProyecto(cookie, "Proyecto origen");
    const destino = await crearProyecto(cookie, "Proyecto destino");

    const t1 = await crearTarea(cookie, origen, "Primera");
    const t2 = await crearTarea(cookie, origen, "Segunda");
    const t3 = await crearTarea(cookie, origen, "Tercera");
    const yaEnDestino = await crearTarea(cookie, destino, "Ya estaba aquí");

    const etiqueta = await app.inject({
      method: "POST",
      url: `/proyectos/${origen}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Urgente", color: "#C8303A" },
    });
    const etiquetaId = (etiqueta.json() as { id: string }).id;
    await app.inject({
      method: "PUT",
      url: `/tareas/${t2}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaId] },
    });

    const columnasDestino = await listarColumnas(cookie, destino);
    const columnaDestino = columnasDestino[0]!;

    const movimiento = await app.inject({
      method: "POST",
      url: `/tareas/${t2}/mover`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { proyectoId: destino, columnaId: columnaDestino.id },
    });
    expect(movimiento.statusCode).toBe(200);
    expect(movimiento.json()).toMatchObject({
      id: t2,
      proyectoId: destino,
      columnaId: columnaDestino.id,
      posicion: 1,
    });

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${t2}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect((detalle.json() as TareaApi).etiquetas).toEqual([]);

    const actividad = await app.inject({
      method: "GET",
      url: `/tareas/${t2}/actividad`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const historial = (
      actividad.json() as { elementos: ElementoHistorial[] }
    ).elementos.filter(
      (elemento) => elemento.tipo === "historial" && elemento.historialTipo === "proyecto",
    );
    expect(historial).toHaveLength(1);
    expect(historial[0]).toMatchObject({
      desdeProyectoId: origen,
      hastaProyectoId: destino,
      desde: "Proyecto origen",
      hasta: "Proyecto destino",
    });

    // El origen queda reindexado sin huecos.
    const restantes = await listarTareas(cookie, origen);
    expect(restantes.map((tarea) => [tarea.id, tarea.posicion])).toEqual([
      [t1, 0],
      [t3, 1],
    ]);

    // El destino coloca la tarea al final.
    const tareasDestino = await listarTareas(cookie, destino);
    expect(tareasDestino.map((tarea) => [tarea.id, tarea.posicion])).toEqual([
      [yaEnDestino, 0],
      [t2, 1],
    ]);
  });

  it("mover al mismo proyecto cambia de columna sin perder las etiquetas", async () => {
    const { cookie } = await registrar("mismo-proyecto");
    const proyecto = await crearProyecto(cookie, "Proyecto solo");
    const tareaId = await crearTarea(cookie, proyecto, "Cambia de columna");
    const columnas = await listarColumnas(cookie, proyecto);

    const etiqueta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyecto}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Sigue", color: "#18794E" },
    });
    const etiquetaId = (etiqueta.json() as { id: string }).id;
    await app.inject({
      method: "PUT",
      url: `/tareas/${tareaId}/etiquetas`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { ids: [etiquetaId] },
    });

    const movimiento = await app.inject({
      method: "POST",
      url: `/tareas/${tareaId}/mover`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { proyectoId: proyecto, columnaId: columnas[1]!.id },
    });
    expect(movimiento.statusCode).toBe(200);
    expect(movimiento.json()).toMatchObject({
      proyectoId: proyecto,
      columnaId: columnas[1]!.id,
    });

    const detalle = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect((detalle.json() as TareaApi).etiquetas).toEqual([etiquetaId]);

    const actividad = await app.inject({
      method: "GET",
      url: `/tareas/${tareaId}/actividad`,
      headers: { cookie: `sesion=${cookie}` },
    });
    const tipos = (actividad.json() as { elementos: ElementoHistorial[] }).elementos.map(
      (elemento) => elemento.historialTipo,
    );
    expect(tipos).toContain("movida");
    expect(tipos).not.toContain("proyecto");
  });

  it("devuelve 404 con tareas, proyectos o columnas ajenos", async () => {
    const alice = await registrar("alice-mover");
    const bob = await registrar("bob-mover");

    const proyectoAlice = await crearProyecto(alice.cookie, "Proyecto de Alice");
    const otroProyectoAlice = await crearProyecto(alice.cookie, "Otro de Alice");
    const tareaAlice = await crearTarea(alice.cookie, proyectoAlice, "Tarea de Alice");
    const columnasAlice = await listarColumnas(alice.cookie, proyectoAlice);
    const columnasOtroAlice = await listarColumnas(alice.cookie, otroProyectoAlice);

    const proyectoBob = await crearProyecto(bob.cookie, "Proyecto de Bob");
    const columnasBob = await listarColumnas(bob.cookie, proyectoBob);

    const tareaAjena = await app.inject({
      method: "POST",
      url: `/tareas/${tareaAlice}/mover`,
      headers: { cookie: `sesion=${bob.cookie}` },
      payload: { proyectoId: proyectoBob, columnaId: columnasBob[0]!.id },
    });
    expect(tareaAjena.statusCode).toBe(404);

    const proyectoAjeno = await app.inject({
      method: "POST",
      url: `/tareas/${tareaAlice}/mover`,
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { proyectoId: proyectoBob, columnaId: columnasBob[0]!.id },
    });
    expect(proyectoAjeno.statusCode).toBe(404);

    const columnaDeOtroProyecto = await app.inject({
      method: "POST",
      url: `/tareas/${tareaAlice}/mover`,
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { proyectoId: proyectoAlice, columnaId: columnasOtroAlice[0]!.id },
    });
    expect(columnaDeOtroProyecto.statusCode).toBe(404);

    const cuerpoInvalido = await app.inject({
      method: "POST",
      url: `/tareas/${tareaAlice}/mover`,
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { proyectoId: "no-es-uuid", columnaId: columnasAlice[1]!.id },
    });
    expect(cuerpoInvalido.statusCode).toBe(400);

    const tareaInexistente = await app.inject({
      method: "POST",
      url: "/tareas/11111111-1111-4111-8111-111111111111/mover",
      headers: { cookie: `sesion=${alice.cookie}` },
      payload: { proyectoId: proyectoAlice, columnaId: columnasAlice[1]!.id },
    });
    expect(tareaInexistente.statusCode).toBe(404);

    // La tarea sigue intacta en su columna original.
    const tareas = await listarTareas(alice.cookie, proyectoAlice);
    expect(tareas.map((tarea) => tarea.id)).toEqual([tareaAlice]);
  });
});
