import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as dbSchema from "./db/schema.js";
import { patronIlike } from "./buscar.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

interface TareaBuscada {
  id: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  proyectoColor: string | null;
  columnaId: string;
  venceEn: string | null;
  hecha: boolean;
}

interface ProyectoBuscado {
  id: string;
  nombre: string;
  color: string | null;
}

interface RespuestaBusqueda {
  tareas: TareaBuscada[];
  proyectos: ProyectoBuscado[];
}

interface ColumnaApi {
  id: string;
  nombre: string;
  posicion: number;
}

function obtenerCookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("búsqueda", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof dbSchema>>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema: dbSchema });
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
    const email = `buscar-${sufijo}@example.com`;
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: { email, nombre: `Usuario ${sufijo}`, contrasena: "contrasena-muy-larga" },
    });
    return { cookie: obtenerCookieSesion(respuesta) };
  }

  async function crearProyecto(
    cookie: string,
    nombre: string,
    color?: string,
  ): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { cookie: `sesion=${cookie}` },
      payload: color ? { nombre, color } : { nombre },
    });
    expect(respuesta.statusCode).toBe(201);
    const id = (respuesta.json() as { id: string }).id;
    if (color) {
      const asignar = await app.inject({
        method: "PATCH",
        url: `/proyectos/${id}`,
        headers: { cookie: `sesion=${cookie}` },
        payload: { color },
      });
      expect(asignar.statusCode).toBe(200);
    }
    return id;
  }

  async function crearTarea(
    cookie: string,
    proyectoId: string,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: `/proyectos/${proyectoId}/tareas`,
      headers: { cookie: `sesion=${cookie}` },
      payload,
    });
    expect(respuesta.statusCode).toBe(201);
    return (respuesta.json() as { id: string }).id;
  }

  async function buscar(cookie: string, q: string): Promise<RespuestaBusqueda> {
    const respuesta = await app.inject({
      method: "GET",
      url: `/buscar?q=${encodeURIComponent(q)}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json() as RespuestaBusqueda;
  }

  async function listarColumnas(cookie: string, proyectoId: string): Promise<ColumnaApi[]> {
    const respuesta = await app.inject({
      method: "GET",
      url: `/proyectos/${proyectoId}/columnas`,
      headers: { cookie: `sesion=${cookie}` },
    });
    return respuesta.json() as ColumnaApi[];
  }

  it("exige entre 2 y 100 caracteres tras recortar espacios", async () => {
    const { cookie } = await registrar("longitud");

    const sinParametro = await app.inject({
      method: "GET",
      url: "/buscar",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(sinParametro.statusCode).toBe(400);

    for (const q of ["", "a", " a ", "x".repeat(101)]) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/buscar?q=${encodeURIComponent(q)}`,
        headers: { cookie: `sesion=${cookie}` },
      });
      expect(respuesta.statusCode, `q=${JSON.stringify(q)}`).toBe(400);
    }

    for (const q of ["ab", " ab ", "x".repeat(100)]) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/buscar?q=${encodeURIComponent(q)}`,
        headers: { cookie: `sesion=${cookie}` },
      });
      expect(respuesta.statusCode, `q=${JSON.stringify(q)}`).toBe(200);
    }
  });

  it("escapa los comodines de ILIKE", async () => {
    const { cookie } = await registrar("comodines");
    const proyectoId = await crearProyecto(cookie, "Proyecto comodines");

    const conPorcentaje = await crearTarea(cookie, proyectoId, { titulo: "Cien por cien 50%" });
    const conGuionBajo = await crearTarea(cookie, proyectoId, { titulo: "Con guion_bajo" });
    const conBarra = await crearTarea(cookie, proyectoId, {
      titulo: "Ruta C:\\imagenes",
    });
    await crearTarea(cookie, proyectoId, { titulo: "Normal sin nada" });

    const porcentaje = await buscar(cookie, "50%");
    expect(porcentaje.tareas.map((tarea) => tarea.id)).toEqual([conPorcentaje]);

    const barra = await buscar(cookie, "\\i");
    expect(barra.tareas.map((tarea) => tarea.id)).toEqual([conBarra]);

    const guionBajo = await buscar(cookie, "guion_bajo");
    expect(guionBajo.tareas.map((tarea) => tarea.id)).toEqual([conGuionBajo]);

    // Un comodín no escapado («%a», «a_») lo encontraría casi todo.
    for (const q of ["%a", "a_"]) {
      const resultado = await buscar(cookie, q);
      expect(resultado.tareas, `q=${q}`).toEqual([]);
    }

    // Un único comodín tampoco arrastra todo: ni siquiera es una búsqueda válida.
    for (const q of ["%", "_", "\\", " "]) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/buscar?q=${encodeURIComponent(q)}`,
        headers: { cookie: `sesion=${cookie}` },
      });
      expect(respuesta.statusCode, `q=${JSON.stringify(q)}`).toBe(400);
    }

    // El patrón interno coincide con lo que espera PostgreSQL con ESCAPE.
    expect(patronIlike("%")).toBe("%\\%%");
    expect(patronIlike("_")).toBe("%\\_%");
    expect(patronIlike("\\")).toBe("%\\\\%");
  });

  it("no mezcla los recursos de otros usuarios", async () => {
    const alice = await registrar("alice-aislamiento");
    const bob = await registrar("bob-aislamiento");

    const proyectoAlice = await crearProyecto(alice.cookie, "Proyecto compartido de Alice");
    const tareaAlice = await crearTarea(alice.cookie, proyectoAlice, {
      titulo: "Tarea compartida de Alice",
    });

    const proyectoBob = await crearProyecto(bob.cookie, "Proyecto compartido de Bob");
    const tareaBob = await crearTarea(bob.cookie, proyectoBob, {
      titulo: "Tarea compartida de Bob",
    });

    const deAlice = await buscar(alice.cookie, "compartid");
    expect(deAlice.proyectos.map((proyecto) => proyecto.id)).toEqual([proyectoAlice]);
    expect(deAlice.tareas.map((tarea) => tarea.id)).toEqual([tareaAlice]);

    const deBob = await buscar(bob.cookie, "compartid");
    expect(deBob.proyectos.map((proyecto) => proyecto.id)).toEqual([proyectoBob]);
    expect(deBob.tareas.map((tarea) => tarea.id)).toEqual([tareaBob]);
  });

  it("limita a 8 tareas y 5 proyectos", async () => {
    const { cookie } = await registrar("limites");
    const proyectoId = await crearProyecto(cookie, "Proyecto límites");

    for (let i = 0; i < 10; i += 1) {
      await crearTarea(cookie, proyectoId, { titulo: `Búsqueda tarea ${i}` });
    }
    for (let i = 0; i < 6; i += 1) {
      await crearProyecto(cookie, `Búsqueda proyecto ${i}`);
    }

    const tareas = await buscar(cookie, "Búsqueda tarea");
    expect(tareas.tareas).toHaveLength(8);

    const proyectos = await buscar(cookie, "Búsqueda proyecto");
    expect(proyectos.proyectos).toHaveLength(5);
  });

  it("ordena primero las coincidencias en el título", async () => {
    const { cookie } = await registrar("orden");
    const proyectoId = await crearProyecto(cookie, "Proyecto orden");

    const enTitulo = await crearTarea(cookie, proyectoId, { titulo: "Coincide en el título" });
    const soloDescripcion = await crearTarea(cookie, proyectoId, {
      titulo: "Otra cosa",
      descripcion: "Aquí también coincide por la descripción",
    });

    const resultado = await buscar(cookie, "coincide");
    expect(resultado.tareas.map((tarea) => tarea.id)).toEqual([enTitulo, soloDescripcion]);
  });

  it("marca hecha según la última columna y no las recurrentes", async () => {
    const { cookie } = await registrar("hecha");
    const proyectoId = await crearProyecto(cookie, "Proyecto hecha");
    const columnas = await listarColumnas(cookie, proyectoId);
    const primera = columnas[0]!;
    const ultima = columnas[columnas.length - 1]!;

    const alfa = await crearTarea(cookie, proyectoId, { titulo: "Marca alfa" });
    const beta = await crearTarea(cookie, proyectoId, { titulo: "Marca beta" });
    const gamma = await crearTarea(cookie, proyectoId, {
      titulo: "Marca gamma",
      columnaId: ultima.id,
      venceEn: "2030-06-06T10:00:00.000Z",
      recurrencia: "FREQ=WEEKLY",
    });

    await app.inject({
      method: "PATCH",
      url: `/tareas/${alfa}`,
      headers: { cookie: `sesion=${cookie}` },
      payload: { columnaId: ultima.id },
    });

    const resultado = await buscar(cookie, "Marca");
    const porId = new Map(resultado.tareas.map((tarea) => [tarea.id, tarea]));

    expect(porId.get(alfa)).toMatchObject({ hecha: true, columnaId: ultima.id });
    expect(porId.get(beta)).toMatchObject({ hecha: false, columnaId: primera.id });
    expect(porId.get(gamma)).toMatchObject({ hecha: false, columnaId: ultima.id });
  });

  it("devuelve nombre y color del proyecto, la fecha y la forma esperada", async () => {
    const { cookie } = await registrar("forma");
    const proyectoId = await crearProyecto(cookie, "Proyecto forma", "#2563D9");
    const venceEn = "2031-01-02T08:30:00.000Z";
    const tareaId = await crearTarea(cookie, proyectoId, {
      titulo: "Revisar la forma",
      venceEn,
    });

    const resultado = await buscar(cookie, "Revisar la forma");
    const columnas = await listarColumnas(cookie, proyectoId);
    expect(resultado.tareas[0]).toEqual({
      id: tareaId,
      titulo: "Revisar la forma",
      proyectoId,
      proyectoNombre: "Proyecto forma",
      proyectoColor: "#2563D9",
      columnaId: columnas[0]!.id,
      venceEn,
      hecha: false,
    });
  });

  it("incluye la bandeja en las tareas pero nunca en los proyectos", async () => {
    const { cookie } = await registrar("bandeja");

    const bandeja = await app.inject({
      method: "GET",
      url: "/bandeja",
      headers: { cookie: `sesion=${cookie}` },
    });
    const proyectoBandeja = (bandeja.json() as { proyecto: { id: string } }).proyecto;

    await crearTarea(cookie, proyectoBandeja.id, { titulo: "Recordar comprar pan" });

    const tareas = await buscar(cookie, "comprar pan");
    expect(tareas.tareas).toHaveLength(1);
    expect(tareas.tareas[0]).toMatchObject({
      proyectoId: proyectoBandeja.id,
      proyectoNombre: "Bandeja de entrada",
    });

    const proyectos = await buscar(cookie, "Bandeja");
    expect(proyectos.proyectos.map((proyecto) => proyecto.id)).not.toContain(proyectoBandeja.id);
  });
});
