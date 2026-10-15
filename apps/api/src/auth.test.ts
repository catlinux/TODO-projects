import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
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

describe("autenticación", () => {
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

  it("rechaza el registro con 403 si está cerrado", async () => {
    const cerrada = await buildApp(db as unknown as Database, { registroAbierto: false });
    await cerrada.ready();
    const respuesta = await cerrada.inject({
      method: "POST",
      url: "/auth/registro",
      payload: { email: "cerrado@example.com", nombre: "X", contrasena: "contrasena-muy-larga" },
    });
    await cerrada.close();

    expect(respuesta.statusCode).toBe(403);
    const filas = await db
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.email, "cerrado@example.com"));
    expect(filas).toHaveLength(0);
  });

  it("registra un usuario y define una cookie httpOnly con SameSite", async () => {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: "uno@example.com",
        nombre: "Uno",
        contrasena: "contrasena-muy-larga",
      },
    });

    expect(respuesta.statusCode).toBe(201);
    const cuerpo = respuesta.json() as { id: string; email: string; nombre: string };
    expect(cuerpo.email).toBe("uno@example.com");
    expect(cuerpo.nombre).toBe("Uno");
    expect(cuerpo).not.toHaveProperty("passwordHash");

    const cookie = String(respuesta.headers["set-cookie"] ?? "");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("registros simultáneos con el mismo correo: uno 201 y otro 409", async () => {
    const peticion = () =>
      app.inject({
        method: "POST",
        url: "/auth/registro",
        payload: {
          email: "carrera@example.com",
          nombre: "Carrera",
          contrasena: "contrasena-larga-1",
        },
      });
    const respuestas = await Promise.all([peticion(), peticion()]);
    expect(respuestas.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it("rechaza el registro duplicado con 409", async () => {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: "uno@example.com",
        nombre: "Duplicado",
        contrasena: "contrasena-muy-larga",
      },
    });

    expect(respuesta.statusCode).toBe(409);
  });

  it("rechaza contraseñas cortas con 400", async () => {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: "corta@example.com",
        nombre: "Corta",
        contrasena: "corta",
      },
    });

    expect(respuesta.statusCode).toBe(400);
  });

  it("inicia sesión con credenciales correctas", async () => {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: {
        email: "uno@example.com",
        contrasena: "contrasena-muy-larga",
      },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ email: "uno@example.com" });
  });

  it("devuelve el mismo 401 para contraseña mala y email inexistente", async () => {
    const mala = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "uno@example.com", contrasena: "contrasena-incorrecta" },
    });
    const inexistente = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "noexiste@example.com", contrasena: "contrasena-incorrecta" },
    });

    expect(mala.statusCode).toBe(401);
    expect(inexistente.statusCode).toBe(401);
    expect(mala.json()).toEqual(inexistente.json());
  });

  it("permite consultar /auth/yo con sesión válida y la rechaza sin cookie", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "uno@example.com", contrasena: "contrasena-muy-larga" },
    });
    const token = obtenerCookieSesion(login);

    const conCookie = await app.inject({
      method: "GET",
      url: "/auth/yo",
      headers: { cookie: `sesion=${token}` },
    });
    expect(conCookie.statusCode).toBe(200);
    expect(conCookie.json()).toMatchObject({ email: "uno@example.com" });

    const sinCookie = await app.inject({ method: "GET", url: "/auth/yo" });
    expect(sinCookie.statusCode).toBe(401);
  });

  it("invalida la sesión al cerrar sesión", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "uno@example.com", contrasena: "contrasena-muy-larga" },
    });
    const token = obtenerCookieSesion(login);

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `sesion=${token}` },
    });
    expect(logout.statusCode).toBe(204);

    const despues = await app.inject({
      method: "GET",
      url: "/auth/yo",
      headers: { cookie: `sesion=${token}` },
    });
    expect(despues.statusCode).toBe(401);
  });

  it("rechaza una sesión expirada", async () => {
    const registro = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: "expirada@example.com",
        nombre: "Expirada",
        contrasena: "contrasena-muy-larga",
      },
    });
    const token = obtenerCookieSesion(registro);

    const filas = await db
      .select({ sesion: schema.sesiones, usuario: schema.usuarios })
      .from(schema.sesiones)
      .innerJoin(schema.usuarios, eq(schema.sesiones.usuarioId, schema.usuarios.id))
      .where(eq(schema.usuarios.email, "expirada@example.com"));
    const sesion = filas[0]?.sesion;
    if (sesion) {
      await db
        .update(schema.sesiones)
        .set({ expiraEn: new Date(Date.now() - 1000) })
        .where(eq(schema.sesiones.id, sesion.id));
    }

    const respuesta = await app.inject({
      method: "GET",
      url: "/auth/yo",
      headers: { cookie: `sesion=${token}` },
    });

    expect(respuesta.statusCode).toBe(401);
  });

  it("guarda password_hash con argon2id y distinto del token", async () => {
    const [usuario] = (await db
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.email, "uno@example.com"))) as [
      typeof schema.usuarios.$inferSelect,
    ];

    expect(usuario.passwordHash.startsWith("$argon2id$")).toBe(true);

    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "uno@example.com", contrasena: "contrasena-muy-larga" },
    });
    const token = obtenerCookieSesion(login);
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const [sesion] = (await db
      .select()
      .from(schema.sesiones)
      .where(eq(schema.sesiones.tokenHash, tokenHash))) as [typeof schema.sesiones.$inferSelect];

    expect(sesion).toBeDefined();
    expect(sesion.tokenHash).not.toBe(token);
  });
});
