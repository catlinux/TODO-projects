import { hash } from "@node-rs/argon2";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { crearBloqueoGlobal, SESION_RECIENTE_MS } from "./acceso.js";
import { buildApp } from "./app.js";
import type { Database } from "./db/index.js";
import * as schema from "./db/schema.js";
import {
  crearAutenticador,
  ORIGEN,
  respuestaEntrada,
  respuestaRegistro,
  type Autenticador,
} from "./webauthn-pruebas.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const PIN = "246813";

function cookieSesion(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const texto = String(Array.isArray(bruto) ? bruto[0] : (bruto ?? ""));
  return texto.match(/sesion=([^;]+)/)?.[1] ?? "";
}

describe("acceso con PIN y huella", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let bloqueo: ReturnType<typeof crearBloqueoGlobal>;
  let usuarioId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    bloqueo = crearBloqueoGlobal();
    app = await buildApp(db as unknown as Database, {
      limiteAuth: { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 },
      accesoCorreo: false,
      registroAbierto: false,
      origenPublico: ORIGEN,
      bloqueoPin: bloqueo,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  beforeEach(async () => {
    bloqueo.reiniciar();
    await db.execute(sql`truncate table passkeys, sesiones, tokens_api, usuarios cascade`);
    const [usuario] = await db
      .insert(schema.usuarios)
      .values({
        email: "propietario@todo.invalid",
        nombre: "Propietario",
        passwordHash: await hash("no-se-usa-nunca"),
        pinHash: await hash(PIN),
      })
      .returning();
    usuarioId = usuario!.id;
  });

  const entrarConPin = (pin: string) =>
    app.inject({ method: "POST", url: "/auth/pin", payload: { pin } });

  async function registrarHuella(cookie: string, aut: Autenticador) {
    const opciones = await app.inject({
      method: "POST",
      url: "/auth/huella/registro-opciones",
      headers: { cookie: `sesion=${cookie}` },
    });
    const { challenge } = opciones.json() as { challenge: string };
    return app.inject({
      method: "POST",
      url: "/auth/huella/registro",
      headers: { cookie: `sesion=${cookie}` },
      payload: { ...respuestaRegistro(aut, challenge), nombre: "Móvil" },
    });
  }

  async function entrarConHuella(aut: Autenticador) {
    const opciones = await app.inject({ method: "POST", url: "/auth/huella/entrada-opciones" });
    const { challenge } = opciones.json() as { challenge: string };
    return app.inject({
      method: "POST",
      url: "/auth/huella/entrada",
      payload: respuestaEntrada(aut, challenge),
    });
  }

  it("informa de los métodos de acceso disponibles", async () => {
    const antes = await app.inject({ method: "GET", url: "/auth/metodos" });
    expect(antes.json()).toEqual({ correo: false, registro: false, pin: true, huella: false });

    await registrarHuella(cookieSesion(await entrarConPin(PIN)), crearAutenticador());
    const despues = await app.inject({ method: "GET", url: "/auth/metodos" });
    expect(despues.json()).toMatchObject({ huella: true });
  });

  it("entra con el PIN correcto y rechaza uno incorrecto o mal formado", async () => {
    const correcto = await entrarConPin(PIN);
    expect(correcto.statusCode).toBe(200);
    expect(cookieSesion(correcto)).not.toBe("");

    expect((await entrarConPin("000000")).statusCode).toBe(401);
    expect((await entrarConPin("12345")).statusCode).toBe(400);
    expect((await entrarConPin("12345a")).statusCode).toBe(400);
  });

  it("con el correo desactivado, /auth/login y /auth/registro responden 403", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "propietario@todo.invalid", contrasena: "no-se-usa-nunca" },
    });
    expect(login.statusCode).toBe(403);
    const registro = await app.inject({
      method: "POST",
      url: "/auth/registro",
      payload: { email: "nuevo@example.com", nombre: "X", contrasena: "contrasena-muy-larga" },
    });
    expect(registro.statusCode).toBe(403);
  });

  it("bloquea el PIN para todos tras 5 fallos, incluso con el PIN correcto", async () => {
    for (let i = 0; i < 4; i++) {
      expect((await entrarConPin("111111")).statusCode).toBe(401);
    }
    const quinto = await entrarConPin("111111");
    expect(quinto.statusCode).toBe(429);
    expect(Number(quinto.headers["retry-after"])).toBe(60);
    expect((await entrarConPin(PIN)).statusCode).toBe(429);
  });

  it("no deja pasar ráfagas en paralelo más allá del bloqueo", async () => {
    const respuestas = await Promise.all(Array.from({ length: 12 }, () => entrarConPin("111111")));
    const noBloqueadas = respuestas.filter((r) => r.statusCode === 401).length;
    expect(noBloqueadas).toBe(4);
  });

  it("escala el bloqueo: 1, 2, 4 minutos", () => {
    const local = crearBloqueoGlobal(2, 60_000);
    expect([local.registrarFallo(), local.registrarFallo()]).toEqual([0, 60]);
    expect([local.registrarFallo(), local.registrarFallo()]).toEqual([0, 120]);
    expect([local.registrarFallo(), local.registrarFallo()]).toEqual([0, 240]);
  });

  it("registra una huella y entra con ella aunque el PIN esté bloqueado", async () => {
    const aut = crearAutenticador();
    const registro = await registrarHuella(cookieSesion(await entrarConPin(PIN)), aut);
    expect(registro.statusCode).toBe(201);

    for (let i = 0; i < 5; i++) await entrarConPin("111111");
    expect((await entrarConPin(PIN)).statusCode).toBe(429);

    const entrada = await entrarConHuella(aut);
    expect(entrada.statusCode).toBe(200);
    expect(cookieSesion(entrada)).not.toBe("");

    // Entrar con la huella levanta el bloqueo del PIN.
    expect((await entrarConPin(PIN)).statusCode).toBe(200);

    const [guardada] = await db
      .select()
      .from(schema.passkeys)
      .where(eq(schema.passkeys.usuarioId, usuarioId));
    expect(guardada?.ultimoUso).not.toBeNull();
  });

  it("rechaza la entrada con una credencial desconocida", async () => {
    expect((await entrarConHuella(crearAutenticador())).statusCode).toBe(401);
  });

  it("no permite gestionar huellas sin sesión ni con un token de API", async () => {
    const sinSesion = await app.inject({ method: "POST", url: "/auth/huella/registro-opciones" });
    expect(sinSesion.statusCode).toBe(401);

    const cookie = cookieSesion(await entrarConPin(PIN));
    const token = await app.inject({
      method: "POST",
      url: "/tokens",
      headers: { cookie: `sesion=${cookie}` },
      payload: { nombre: "Token", permiso: "escritura" },
    });
    const { token: valor } = token.json() as { token: string };
    const conToken = await app.inject({
      method: "GET",
      url: "/auth/huella",
      headers: { authorization: `Bearer ${valor}` },
    });
    expect(conToken.statusCode).toBe(403);
  });

  it("rechaza las escrituras con un Origin ajeno y acepta el propio o ninguno (CSRF)", async () => {
    const ajeno = await app.inject({
      method: "POST",
      url: "/auth/pin",
      headers: { origin: "https://malicioso.example" },
      payload: { pin: PIN },
    });
    expect(ajeno.statusCode).toBe(403);
    expect(ajeno.json()).toEqual({ mensaje: "Origen no permitido" });

    const propio = await app.inject({
      method: "POST",
      url: "/auth/pin",
      headers: { origin: ORIGEN },
      payload: { pin: PIN },
    });
    expect(propio.statusCode).toBe(200);

    // Sin cabecera Origin (clientes de API, curl) se deja pasar.
    expect((await entrarConPin(PIN)).statusCode).toBe(200);
  });

  it("exige una sesión reciente para registrar una huella", async () => {
    const cookie = cookieSesion(await entrarConPin(PIN));
    await db
      .update(schema.sesiones)
      .set({ createdAt: new Date(Date.now() - SESION_RECIENTE_MS - 60_000) })
      .where(eq(schema.sesiones.usuarioId, usuarioId));

    const opciones = await app.inject({
      method: "POST",
      url: "/auth/huella/registro-opciones",
      headers: { cookie: `sesion=${cookie}` },
    });
    expect(opciones.statusCode).toBe(403);
    expect(opciones.json()).toEqual({
      mensaje: "Vuelve a entrar para añadir un dispositivo",
      codigo: "reautenticar",
    });

    const registro = await app.inject({
      method: "POST",
      url: "/auth/huella/registro",
      headers: { cookie: `sesion=${cookie}` },
      payload: { ...respuestaRegistro(crearAutenticador(), "reto-caducado"), nombre: "Móvil" },
    });
    expect(registro.statusCode).toBe(403);

    // Con una sesión recién creada sí se puede registrar.
    const reciente = cookieSesion(await entrarConPin(PIN));
    const correcta = await app.inject({
      method: "POST",
      url: "/auth/huella/registro-opciones",
      headers: { cookie: `sesion=${reciente}` },
    });
    expect(correcta.statusCode).toBe(200);
    expect(correcta.json()).toMatchObject({ challenge: expect.any(String) });
  });

  it("lista y borra las huellas propias", async () => {
    const cookie = cookieSesion(await entrarConPin(PIN));
    await registrarHuella(cookie, crearAutenticador());
    const lista = await app.inject({
      method: "GET",
      url: "/auth/huella",
      headers: { cookie: `sesion=${cookie}` },
    });
    const [huella] = lista.json() as { id: string; nombre: string }[];
    expect(huella?.nombre).toBe("Móvil");

    const borrar = (id: string) =>
      app.inject({
        method: "DELETE",
        url: `/auth/huella/${id}`,
        headers: { cookie: `sesion=${cookie}` },
      });
    expect((await borrar("no-es-uuid")).statusCode).toBe(404);
    expect((await borrar(huella!.id)).statusCode).toBe(204);
    expect((await borrar(huella!.id)).statusCode).toBe(404);
  });
});
