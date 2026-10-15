import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { type FastifyInstance } from "fastify";

import { buildApp, type OpcionesApp } from "./app.js";
import { MENSAJE_DEMASIADOS_INTENTOS } from "./auth.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

describe("límites de intentos", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const apps: FastifyInstance[] = [];

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  afterEach(async () => {
    await Promise.all(apps.map((app) => app.close()));
    apps.length = 0;
  });

  afterAll(async () => {
    await client.close();
  });

  async function crearApp(opciones: OpcionesApp): Promise<FastifyInstance> {
    const app = await buildApp(db as unknown as Database, opciones);
    await app.ready();
    apps.push(app);
    return app;
  }

  function login(app: FastifyInstance, email: string, remoteAddress?: string) {
    return app.inject({
      method: "POST",
      url: "/auth/login",
      ...(remoteAddress ? { remoteAddress } : {}),
      payload: { email, contrasena: "contrasena-incorrecta" },
    });
  }

  it("bloquea el undécimo login desde la misma IP con Retry-After", async () => {
    const app = await crearApp({ limiteAuth: { max: 10, ventanaMs: 60_000, maxPorCorreo: 1000 } });

    const estados: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const respuesta = await login(app, "ip@example.com");
      estados.push(respuesta.statusCode);
      if (i === 10) {
        expect(respuesta.headers["retry-after"]).toBeDefined();
        expect(respuesta.json()).toEqual({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
      }
    }

    expect(estados.slice(0, 10)).toEqual(Array<number>(10).fill(401));
    expect(estados[10]).toBe(429);
  });

  it("bloquea un correo tras 5 fallos aunque cambie la IP", async () => {
    const app = await crearApp({
      limiteAuth: { max: 1000, ventanaMs: 60_000, maxPorCorreo: 5 },
    });

    const estados: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const respuesta = await login(app, "correo@example.com", `10.0.0.${i + 1}`);
      estados.push(respuesta.statusCode);
      if (i === 4) {
        expect(respuesta.headers["retry-after"]).toBeDefined();
        expect(respuesta.json()).toEqual({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
      }
    }

    expect(estados).toEqual([401, 401, 401, 401, 429]);
  });

  it("un login correcto reinicia el contador por correo", async () => {
    const app = await crearApp({
      limiteAuth: { max: 1000, ventanaMs: 60_000, maxPorCorreo: 5 },
    });

    const registro = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: "reset@example.com",
        nombre: "Reset",
        contrasena: "contrasena-muy-larga",
      },
    });
    expect(registro.statusCode).toBe(201);

    for (let i = 0; i < 4; i += 1) {
      const fallo = await login(app, "reset@example.com", `10.0.1.${i + 1}`);
      expect(fallo.statusCode).toBe(401);
    }

    const correcto = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: "10.0.1.10",
      payload: { email: "reset@example.com", contrasena: "contrasena-muy-larga" },
    });
    expect(correcto.statusCode).toBe(200);

    const despues = await login(app, "reset@example.com", "10.0.1.11");
    expect(despues.statusCode).toBe(401);
  });

  it("limita el registro", async () => {
    const app = await crearApp({ limiteAuth: { max: 3, ventanaMs: 60_000, maxPorCorreo: 1000 } });

    for (let i = 0; i < 3; i += 1) {
      const respuesta = await app.inject({
        method: "POST",
        url: "/auth/registro",
        payload: {
          email: `registro-${i}@example.com`,
          nombre: `Registro ${i}`,
          contrasena: "contrasena-muy-larga",
        },
      });
      expect(respuesta.statusCode).toBe(201);
    }

    const bloqueado = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: "registro-4@example.com",
        nombre: "Registro 4",
        contrasena: "contrasena-muy-larga",
      },
    });
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.headers["retry-after"]).toBeDefined();
    expect(bloqueado.json()).toEqual({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
  });

  it("no limita las demás rutas", async () => {
    const app = await crearApp({ limiteAuth: { max: 1, ventanaMs: 60_000, maxPorCorreo: 1 } });

    for (let i = 0; i < 5; i += 1) {
      const salud = await app.inject({ method: "GET", url: "/salud" });
      expect(salud.statusCode).toBe(200);

      const logout = await app.inject({ method: "POST", url: "/auth/logout" });
      expect(logout.statusCode).toBe(204);
    }
  });
});
