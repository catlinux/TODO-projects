import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp } from "../app.js";
import type { Database } from "../db/index.js";
import { suscripcionesPush } from "../db/schema.js";
import * as schema from "../db/schema.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

const suscripcion = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "clave-p256dh", auth: "clave-auth" },
};

describe("rutas de suscripción push", () => {
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

  async function crearApp(vapidPublicKey: string | null): Promise<FastifyInstance> {
    const app = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      vapidPublicKey,
    });
    await app.ready();
    apps.push(app);
    return app;
  }

  async function registrar(app: FastifyInstance, sufijo: string): Promise<string> {
    const respuesta = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `push-${sufijo}@example.com`,
        nombre: sufijo,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  it("exige sesión", async () => {
    const app = await crearApp("clave-publica");

    for (const peticion of [
      { method: "GET" as const, url: "/push/clave" },
      { method: "POST" as const, url: "/push/suscripcion", payload: suscripcion },
      {
        method: "DELETE" as const,
        url: "/push/suscripcion",
        payload: { endpoint: suscripcion.endpoint },
      },
    ]) {
      const respuesta = await app.inject(peticion);
      expect(respuesta.statusCode).toBe(401);
    }
  });

  it("devuelve 404 si no hay clave VAPID y 200 si la hay", async () => {
    const sinConfigurar = await crearApp(null);
    const cookie = await registrar(sinConfigurar, "sin-config");

    const sinClave = await sinConfigurar.inject({
      method: "GET",
      url: "/push/clave",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(sinClave.statusCode).toBe(404);
    expect(sinClave.json()).toEqual({ mensaje: "Avisos push no configurados" });

    const configurada = await crearApp("clave-publica");
    const cookie2 = await registrar(configurada, "con-config");
    const conClave = await configurada.inject({
      method: "GET",
      url: "/push/clave",
      headers: { cookie: `sesion=${cookie2}` },
    });
    expect(conClave.statusCode).toBe(200);
    expect(conClave.json()).toEqual({ clave: "clave-publica" });
  });

  it("da de alta una suscripción y repetir la alta es upsert", async () => {
    const app = await crearApp("clave-publica");
    const cookie = await registrar(app, "alta");

    const primera = await app.inject({
      method: "POST",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookie}` },
      payload: suscripcion,
    });
    expect(primera.statusCode).toBe(204);

    const actualizada = await app.inject({
      method: "POST",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookie}` },
      payload: { ...suscripcion, keys: { p256dh: "otra-p256dh", auth: "otra-auth" } },
    });
    expect(actualizada.statusCode).toBe(204);

    const filas = await db
      .select()
      .from(suscripcionesPush)
      .where(eq(suscripcionesPush.endpoint, suscripcion.endpoint));
    expect(filas).toHaveLength(1);
    expect(filas[0]!.p256dh).toBe("otra-p256dh");
  });

  it("otro usuario puede reasignar el mismo endpoint", async () => {
    const app = await crearApp("clave-publica");
    const cookieA = await registrar(app, "reasigna-a");
    const cookieB = await registrar(app, "reasigna-b");

    await app.inject({
      method: "POST",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookieA}` },
      payload: suscripcion,
    });
    await app.inject({
      method: "POST",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookieB}` },
      payload: suscripcion,
    });

    const filas = await db
      .select()
      .from(suscripcionesPush)
      .where(eq(suscripcionesPush.endpoint, suscripcion.endpoint));
    expect(filas).toHaveLength(1);
    const usuarioB = await db
      .select({ id: schema.usuarios.id })
      .from(schema.usuarios)
      .where(eq(schema.usuarios.email, "push-reasigna-b@example.com"));
    expect(filas[0]!.usuarioId).toBe(usuarioB[0]!.id);
  });

  it("la baja es idempotente y solo borra la propia", async () => {
    const app = await crearApp("clave-publica");
    const cookieA = await registrar(app, "baja-a");
    const cookieB = await registrar(app, "baja-b");

    await app.inject({
      method: "POST",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookieA}` },
      payload: suscripcion,
    });

    const ajena = await app.inject({
      method: "DELETE",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookieB}` },
      payload: { endpoint: suscripcion.endpoint },
    });
    expect(ajena.statusCode).toBe(204);
    expect(await db.select().from(suscripcionesPush)).toHaveLength(1);

    const propia = await app.inject({
      method: "DELETE",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookieA}` },
      payload: { endpoint: suscripcion.endpoint },
    });
    expect(propia.statusCode).toBe(204);
    expect(await db.select().from(suscripcionesPush)).toHaveLength(0);

    const repetida = await app.inject({
      method: "DELETE",
      url: "/push/suscripcion",
      headers: { cookie: `sesion=${cookieA}` },
      payload: { endpoint: suscripcion.endpoint },
    });
    expect(repetida.statusCode).toBe(204);
  });

  it("valida el cuerpo con 400", async () => {
    const app = await crearApp("clave-publica");
    const cookie = await registrar(app, "validacion");

    const invalidos = [
      { endpoint: "http://push.example.com/abc", keys: suscripcion.keys },
      { endpoint: "https://push.example.com/abc" },
      { endpoint: "https://push.example.com/abc", keys: { p256dh: "", auth: "a" } },
    ];

    for (const payload of invalidos) {
      const respuesta = await app.inject({
        method: "POST",
        url: "/push/suscripcion",
        headers: { cookie: `sesion=${cookie}` },
        payload,
      });
      expect(respuesta.statusCode).toBe(400);
    }
  });
});
