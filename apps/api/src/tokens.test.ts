import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import { tokensApi } from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

describe("tokens de API", () => {
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
      sql`truncate table tokens_api, ocurrencias_hechas, avisos_enviados, suscripciones_push, tareas, columnas, proyectos, usuarios restart identity cascade`,
    );
  });

  async function registrar(): Promise<string> {
    contador += 1;
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `token-${contador}@example.com`,
        nombre: `Usuario ${contador}`,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  async function crearToken(
    cookie: string,
    datos: { nombre?: string; permiso?: string; expiraEn?: string },
  ) {
    return app.inject({
      method: "POST",
      url: "/tokens",
      headers: { cookie: `sesion=${cookie}` },
      payload: {
        nombre: datos.nombre ?? "Token",
        permiso: datos.permiso ?? "lectura",
        ...(datos.expiraEn ? { expiraEn: datos.expiraEn } : {}),
      },
    });
  }

  it("no permite gestionar tokens sin sesión ni con Bearer", async () => {
    const cookie = await registrar();
    const creado = await crearToken(cookie, { permiso: "escritura" });
    const { token } = creado.json() as { token: string };

    const sinSesion = await app.inject({ method: "GET", url: "/tokens" });
    expect(sinSesion.statusCode).toBe(403);

    const conBearer = await app.inject({
      method: "GET",
      url: "/tokens",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(conBearer.statusCode).toBe(403);

    const crearConBearer = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { authorization: `Bearer ${token}` },
      payload: { nombre: "Otro", permiso: "lectura" },
    });
    expect(crearConBearer.statusCode).toBe(403);
  });

  it("crea un token que solo se muestra en la respuesta", async () => {
    const cookie = await registrar();
    const respuesta = await crearToken(cookie, { nombre: "MCP", permiso: "escritura" });
    expect(respuesta.statusCode).toBe(201);
    const cuerpo = respuesta.json() as {
      id: string;
      nombre: string;
      permiso: string;
      prefijo: string;
      token: string;
    };

    expect(cuerpo.token.startsWith("tdp_")).toBe(true);
    expect(cuerpo.prefijo).toBe(cuerpo.token.slice(0, 8));

    const [fila] = await db.select().from(tokensApi).where(eq(tokensApi.id, cuerpo.id));
    expect(fila!.tokenHash).not.toBe(cuerpo.token);
    expect(fila!.tokenHash).toBe(createHash("sha256").update(cuerpo.token).digest("hex"));

    const listado = await app.inject({
      method: "GET",
      url: "/tokens",
      headers: { cookie: `sesion=${cookie}` },
    });
    const tokens = listado.json() as Array<Record<string, unknown>>;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).not.toHaveProperty("token");
    expect(tokens[0]).not.toHaveProperty("tokenHash");
    expect(tokens[0]).toMatchObject({ id: cuerpo.id, nombre: "MCP", permiso: "escritura" });
  });

  it("revoca un token y es idempotente", async () => {
    const cookie = await registrar();
    const otro = await registrar();
    const creado = await crearToken(cookie, { permiso: "lectura" });
    const { id } = creado.json() as { id: string };

    const ajeno = await app.inject({
      method: "DELETE",
      url: `/tokens/${id}`,
      headers: { cookie: `sesion=${otro}` },
    });
    expect(ajeno.statusCode).toBe(404);

    const revocar = await app.inject({
      method: "DELETE",
      url: `/tokens/${id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(revocar.statusCode).toBe(204);

    const repetir = await app.inject({
      method: "DELETE",
      url: `/tokens/${id}`,
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(repetir.statusCode).toBe(204);

    const listado = await app.inject({
      method: "GET",
      url: "/tokens",
      headers: { cookie: `sesion=${cookie}` },
    });
    const [token] = listado.json() as Array<{ revocadoEn: string | null }>;
    expect(token!.revocadoEn).not.toBeNull();
  });

  it("limita a 20 tokens activos", async () => {
    const cookie = await registrar();
    for (let i = 0; i < 20; i += 1) {
      const respuesta = await crearToken(cookie, { nombre: `Token ${i}`, permiso: "lectura" });
      expect(respuesta.statusCode).toBe(201);
    }

    const extra = await crearToken(cookie, { nombre: "Token 21", permiso: "lectura" });
    expect(extra.statusCode).toBe(409);
  });

  it("autentica con Bearer y actualiza ultimo_uso", async () => {
    const cookie = await registrar();
    const creado = await crearToken(cookie, { permiso: "lectura" });
    const { id, token } = creado.json() as { id: string; token: string };

    const [antes] = await db.select().from(tokensApi).where(eq(tokensApi.id, id));
    expect(antes!.ultimoUso).toBeNull();

    const respuesta = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(respuesta.statusCode).toBe(200);

    const [despues] = await db.select().from(tokensApi).where(eq(tokensApi.id, id));
    expect(despues!.ultimoUso).not.toBeNull();
  });

  it("aplica los permisos de lectura, escritura y calendario", async () => {
    const cookie = await registrar();

    const lectura = (await crearToken(cookie, { permiso: "lectura" })).json() as { token: string };
    const escritura = (await crearToken(cookie, { permiso: "escritura" })).json() as {
      token: string;
    };
    const calendario = (await crearToken(cookie, { permiso: "calendario" })).json() as {
      token: string;
    };

    const getLectura = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { authorization: `Bearer ${lectura.token}` },
    });
    expect(getLectura.statusCode).toBe(200);

    const postLectura = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { authorization: `Bearer ${lectura.token}` },
      payload: { nombre: "No" },
    });
    expect(postLectura.statusCode).toBe(403);

    const postEscritura = await app.inject({
      method: "POST",
      url: "/proyectos",
      headers: { authorization: `Bearer ${escritura.token}` },
      payload: { nombre: "Sí" },
    });
    expect(postEscritura.statusCode).toBe(201);

    const pushEscritura = await app.inject({
      method: "GET",
      url: "/push/clave",
      headers: { authorization: `Bearer ${escritura.token}` },
    });
    expect(pushEscritura.statusCode).toBe(403);

    const yoEscritura = await app.inject({
      method: "GET",
      url: "/auth/yo",
      headers: { authorization: `Bearer ${escritura.token}` },
    });
    expect(yoEscritura.statusCode).toBe(403);

    const icsCalendario = await app.inject({
      method: "GET",
      url: "/agenda.ics",
      headers: { authorization: `Bearer ${calendario.token}` },
    });
    expect(icsCalendario.statusCode).toBe(200);

    const proyectosCalendario = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { authorization: `Bearer ${calendario.token}` },
    });
    expect(proyectosCalendario.statusCode).toBe(403);
  });

  it("acepta ?token= en /agenda.ics para cualquier permiso", async () => {
    const cookie = await registrar();
    const lectura = (await crearToken(cookie, { permiso: "lectura" })).json() as { token: string };
    const calendario = (await crearToken(cookie, { permiso: "calendario" })).json() as {
      token: string;
    };

    for (const token of [lectura.token, calendario.token]) {
      const respuesta = await app.inject({
        method: "GET",
        url: `/agenda.ics?token=${encodeURIComponent(token)}`,
      });
      expect(respuesta.statusCode).toBe(200);
    }

    const invalido = await app.inject({ method: "GET", url: "/agenda.ics?token=malo" });
    expect(invalido.statusCode).toBe(401);
  });

  it("rechaza tokens revocados, caducados o inexistentes", async () => {
    const cookie = await registrar();
    const revocado = (await crearToken(cookie, { permiso: "lectura" })).json() as {
      id: string;
      token: string;
    };
    await app.inject({
      method: "DELETE",
      url: `/tokens/${revocado.id}`,
      headers: { cookie: `sesion=${cookie}` },
    });

    const conRevocado = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { authorization: `Bearer ${revocado.token}` },
    });
    expect(conRevocado.statusCode).toBe(401);

    const caducado = (await crearToken(cookie, { permiso: "lectura" })).json() as {
      id: string;
      token: string;
    };
    await db
      .update(tokensApi)
      .set({ expiraEn: new Date(Date.now() - 1000) })
      .where(eq(tokensApi.id, caducado.id));

    const conCaducado = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { authorization: `Bearer ${caducado.token}` },
    });
    expect(conCaducado.statusCode).toBe(401);

    const inexistente = await app.inject({
      method: "GET",
      url: "/proyectos",
      headers: { authorization: "Bearer tdp_inexistente" },
    });
    expect(inexistente.statusCode).toBe(401);
  });

  it("rechaza una caducidad pasada al crear", async () => {
    const cookie = await registrar();
    const respuesta = await crearToken(cookie, {
      permiso: "lectura",
      expiraEn: "2020-01-01T00:00:00.000Z",
    });
    expect(respuesta.statusCode).toBe(400);
  });

  it("limita los intentos con token inválido por IP", async () => {
    const appLimitada = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      limiteTokens: { max: 3, ventanaMs: 60_000 },
    });
    await appLimitada.ready();

    const estados: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const respuesta = await appLimitada.inject({
        method: "GET",
        url: "/proyectos",
        remoteAddress: "10.9.9.9",
        headers: { authorization: "Bearer tdp_malo" },
      });
      estados.push(respuesta.statusCode);
      if (i === 2) {
        expect(respuesta.headers["retry-after"]).toBeDefined();
      }
    }

    expect(estados).toEqual([401, 401, 429]);
    await appLimitada.close();
  });
});
