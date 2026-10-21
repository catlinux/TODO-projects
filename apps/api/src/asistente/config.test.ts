import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { count, eq } from "drizzle-orm";
import { type FastifyInstance } from "fastify";

import { buildApp } from "../app.js";
import type { Database } from "../db/index.js";
import * as schema from "../db/schema.js";
import { asistenteConfig } from "../db/schema.js";
import { cifrarClave, descifrarClave, leerClaveCifrado } from "./cifrado.js";
import { VERSION } from "../version.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

const CLAVE_CIFRADO = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const OTRA_CLAVE_CIFRADO = Buffer.from("fedcba9876543210fedcba9876543210", "utf8");
const CLAVE_PROVEEDOR = "sk-prueba-1234";

function obtenerCookie(respuesta: { headers: Record<string, unknown> }): string {
  const bruto = respuesta.headers["set-cookie"];
  const valor = Array.isArray(bruto) ? bruto[0]! : bruto;
  const texto = String(valor ?? "");
  const coincidencia = texto.match(/sesion=([^;]+)/);
  return coincidencia?.[1] ?? "";
}

function respuestas(app: FastifyInstance, cookie: string) {
  const cabeceras = { cookie: `sesion=${cookie}` };
  return {
    get: () => app.inject({ method: "GET", url: "/asistente/config", headers: cabeceras }),
    put: (payload: Record<string, unknown>) =>
      app.inject({ method: "PUT", url: "/asistente/config", headers: cabeceras, payload }),
    borrar: () => app.inject({ method: "DELETE", url: "/asistente/config", headers: cabeceras }),
    probar: (payload: Record<string, unknown> = {}) =>
      app.inject({ method: "POST", url: "/asistente/probar", headers: cabeceras, payload }),
  };
}

interface PeticionFalsa {
  url: string;
  authorization: string;
  agenteUsuario: string;
  sesion: string | null;
  cuerpo: Record<string, unknown>;
}

interface ServidorFalso {
  baseUrl: string;
  peticiones: PeticionFalsa[];
  cerrar: () => Promise<void>;
}

/** Servidor Chat Completions falso: responde 200, 401 o deja la petición colgada (timeout). */
function crearServidorFalso(
  comportamiento: "ok" | "401" | "esperar" | "vacio",
): Promise<ServidorFalso> {
  const peticiones: PeticionFalsa[] = [];
  const server: Server = createServer((peticion, respuesta) => {
    const trozos: Buffer[] = [];
    peticion.on("data", (trozo) => trozos.push(trozo as Buffer));
    peticion.on("end", () => {
      peticiones.push({
        url: peticion.url ?? "",
        authorization: String(peticion.headers.authorization ?? ""),
        agenteUsuario: String(peticion.headers["user-agent"] ?? ""),
        sesion:
          typeof peticion.headers["x-opencode-session"] === "string"
            ? peticion.headers["x-opencode-session"]
            : null,
        cuerpo: JSON.parse(Buffer.concat(trozos).toString("utf8") || "{}") as Record<
          string,
          unknown
        >,
      });
      if (comportamiento === "esperar") {
        return;
      }
      if (comportamiento === "401") {
        respuesta.writeHead(401, { "content-type": "application/json" });
        respuesta.end(JSON.stringify({ error: { message: "Invalid API key" } }));
        return;
      }
      if (comportamiento === "vacio") {
        // El presupuesto se fue en razonar: 200 con elección válida y contenido vacío.
        respuesta.writeHead(200, { "content-type": "application/json" });
        respuesta.end(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "", reasoning_content: "Pensando…" },
                finish_reason: "length",
              },
            ],
            usage: { completion_tokens_details: { reasoning_tokens: 256 } },
          }),
        );
        return;
      }
      respuesta.writeHead(200, { "content-type": "application/json" });
      respuesta.end(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "OK" } }] }),
      );
    });
  });

  return new Promise((resolver, rechazar) => {
    server.on("error", rechazar);
    server.listen(0, "127.0.0.1", () => {
      const direccion = server.address();
      const puerto = typeof direccion === "object" && direccion ? direccion.port : 0;
      resolver({
        baseUrl: `http://127.0.0.1:${puerto}`,
        peticiones,
        cerrar: () =>
          new Promise<void>((listo) => {
            server.closeAllConnections();
            server.close(() => listo());
          }),
      });
    });
  });
}

describe("cifrado de la clave del asistente", () => {
  it("cifra y descifra ida y vuelta, y falla con otra clave", () => {
    const guardada = cifrarClave(CLAVE_PROVEEDOR, CLAVE_CIFRADO);
    expect(guardada).not.toContain(CLAVE_PROVEEDOR);
    expect(descifrarClave(guardada, CLAVE_CIFRADO)).toBe(CLAVE_PROVEEDOR);
    expect(descifrarClave(guardada, OTRA_CLAVE_CIFRADO)).toBeNull();
    expect(descifrarClave("v1.solo.dos", CLAVE_CIFRADO)).toBeNull();
    expect(descifrarClave("basura", CLAVE_CIFRADO)).toBeNull();
  });

  it("solo acepta ASISTENTE_CLAVE_CIFRADO con 32 bytes en base64", () => {
    expect(leerClaveCifrado({})).toBeNull();
    expect(leerClaveCifrado({ ASISTENTE_CLAVE_CIFRADO: "" })).toBeNull();
    expect(leerClaveCifrado({ ASISTENTE_CLAVE_CIFRADO: "demasiado-corta" })).toBeNull();
    expect(leerClaveCifrado({ ASISTENTE_CLAVE_CIFRADO: CLAVE_CIFRADO.toString("base64") })).toEqual(
      CLAVE_CIFRADO,
    );
  });
});

describe("configuración del proveedor del asistente", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let app: FastifyInstance;
  let appSinClave: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    const limites = { max: 100000, ventanaMs: 60 * 60 * 1000, maxPorCorreo: 100000 };
    app = await buildApp(db as unknown as Database, {
      limiteAuth: limites,
      asistente: { claveCifrado: CLAVE_CIFRADO, tiempoMaximoPruebaMs: 300 },
    });
    await app.ready();
    appSinClave = await buildApp(db as unknown as Database, {
      limiteAuth: limites,
      asistente: { claveCifrado: null },
    });
    await appSinClave.ready();
  });

  afterAll(async () => {
    await app.close();
    await appSinClave.close();
    await client.close();
  });

  async function registrar(cual: FastifyInstance, sufijo: string): Promise<string> {
    const respuesta = await cual.inject({
      method: "POST",
      url: "/auth/registro",
      payload: {
        email: `asistente-${sufijo}@example.com`,
        nombre: sufijo,
        contrasena: "contrasena-muy-larga",
      },
    });
    return obtenerCookie(respuesta);
  }

  it("guarda y devuelve la configuración sin exponer la clave", async () => {
    const cookie = await registrar(app, "guardar");
    const api = respuestas(app, cookie);

    const antes = await api.get();
    expect(antes.statusCode).toBe(200);
    expect(antes.json()).toMatchObject({
      disponible: true,
      configurado: false,
      claveTermina: null,
    });

    const creacion = await api.put({ preset: "deepseek", clave: CLAVE_PROVEEDOR });
    expect(creacion.statusCode).toBe(200);
    expect(creacion.json()).toMatchObject({
      disponible: true,
      configurado: true,
      preset: "deepseek",
      baseUrl: "https://api.deepseek.com",
      modelo: "deepseek-flash",
      razonamiento: null,
      claveTermina: "…1234",
    });
    expect(creacion.body).not.toContain(CLAVE_PROVEEDOR);

    const guardada = await api.get();
    expect(guardada.json()).toMatchObject({ configurado: true, claveTermina: "…1234" });
    expect(guardada.body).not.toContain(CLAVE_PROVEEDOR);

    const [fila] = await db.select().from(asistenteConfig).limit(1);
    expect(fila?.claveCifrada).not.toContain(CLAVE_PROVEEDOR);
    expect(descifrarClave(fila!.claveCifrada, CLAVE_CIFRADO)).toBe(CLAVE_PROVEEDOR);
  });

  it("aplica los defectos de cada preset y conserva la clave si no se envía", async () => {
    const cookie = await registrar(app, "presets");
    const api = respuestas(app, cookie);

    const openai = await api.put({ preset: "openai", clave: CLAVE_PROVEEDOR });
    expect(openai.json()).toMatchObject({
      preset: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelo: "gpt-6-luna",
      razonamiento: "none",
      claveTermina: "…1234",
    });

    const personalizado = await api.put({
      preset: "personalizado",
      baseUrl: "http://localhost:11434/v1",
      modelo: "mi-modelo",
      razonamiento: null,
    });
    expect(personalizado.json()).toMatchObject({
      preset: "personalizado",
      baseUrl: "http://localhost:11434/v1",
      modelo: "mi-modelo",
      razonamiento: null,
      claveTermina: "…1234",
    });

    const tercera = await api.put({ preset: "personalizado", modelo: "otro-modelo" });
    expect(tercera.json()).toMatchObject({
      baseUrl: "http://localhost:11434/v1",
      modelo: "otro-modelo",
      claveTermina: "…1234",
    });

    const opencodeGo = await api.put({ preset: "opencode-go" });
    expect(opencodeGo.json()).toMatchObject({
      preset: "opencode-go",
      baseUrl: "https://opencode.ai/inference/go/openai/v1",
      modelo: "deepseek-v4.1-flash",
      razonamiento: null,
      claveTermina: "…1234",
    });
  });

  it("valida la URL base, el modelo y el proveedor", async () => {
    const cookie = await registrar(app, "validacion");
    const api = respuestas(app, cookie);

    expect(
      (
        await api.put({
          preset: "personalizado",
          baseUrl: "http://ejemplo.com",
          modelo: "m",
          clave: "k-1234",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await api.put({ preset: "personalizado", baseUrl: "https://ejemplo.com", clave: "k-1234" }))
        .statusCode,
    ).toBe(400);
    expect(
      (await api.put({ preset: "personalizado", baseUrl: "https://ejemplo.com", modelo: "m" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await api.put({
          preset: "raro",
          baseUrl: "https://ejemplo.com",
          modelo: "m",
          clave: "k-1234",
        })
      ).statusCode,
    ).toBe(400);

    const valida = await api.put({
      preset: "personalizado",
      baseUrl: "http://127.0.0.1:9999",
      modelo: "m",
      clave: "k-1234",
    });
    expect(valida.statusCode).toBe(200);
  });

  it("borra la configuración", async () => {
    const cookie = await registrar(app, "borrar");
    const api = respuestas(app, cookie);
    await api.put({ preset: "deepseek", clave: CLAVE_PROVEEDOR });

    const borrado = await api.borrar();
    expect(borrado.statusCode).toBe(204);
    expect((await api.get()).json()).toMatchObject({ configurado: false, claveTermina: null });
    expect((await api.borrar()).statusCode).toBe(204);
  });

  it("aísla la configuración entre usuarios", async () => {
    const alice = respuestas(app, await registrar(app, "alice"));
    const bob = respuestas(app, await registrar(app, "bob"));

    await alice.put({ preset: "deepseek", clave: "sk-alice-1234" });
    expect((await bob.get()).json()).toMatchObject({ configurado: false, claveTermina: null });

    await bob.put({ preset: "openai", clave: "sk-bob-5678" });
    expect((await alice.get()).json()).toMatchObject({
      preset: "deepseek",
      claveTermina: "…1234",
    });
    expect((await bob.get()).json()).toMatchObject({ preset: "openai", claveTermina: "…5678" });

    const [filas] = await db.select({ total: count() }).from(asistenteConfig);
    expect(filas?.total).toBeGreaterThanOrEqual(2);
  });

  it("sin ASISTENTE_CLAVE_CIFRADO no está disponible y PUT responde 503", async () => {
    const cookie = await registrar(appSinClave, "sin-clave");
    const api = respuestas(appSinClave, cookie);

    expect((await api.get()).json()).toEqual({
      disponible: false,
      configurado: false,
      preset: null,
      baseUrl: null,
      modelo: null,
      razonamiento: null,
      claveTermina: null,
    });

    const fallo = await api.put({ preset: "deepseek", clave: CLAVE_PROVEEDOR });
    expect(fallo.statusCode).toBe(503);
    expect((fallo.json() as { mensaje: string }).mensaje).toContain("ASISTENTE_CLAVE_CIFRADO");

    const [filas] = await db
      .select({ total: count() })
      .from(asistenteConfig)
      .where(eq(asistenteConfig.claveCifrada, ""));
    expect(filas?.total).toBe(0);
  });

  it("prueba el proveedor contra un servidor Chat Completions falso", async () => {
    const servidor = await crearServidorFalso("ok");
    try {
      const cookie = await registrar(app, "probar-ok");
      const api = respuestas(app, cookie);
      const guardado = await api.put({
        preset: "personalizado",
        baseUrl: servidor.baseUrl,
        modelo: "modelo-falso",
        razonamiento: "low",
        clave: "sk-prueba-1234",
      });
      expect(guardado.statusCode).toBe(200);

      const prueba = await api.probar();
      expect(prueba.statusCode).toBe(200);
      expect(prueba.json()).toEqual({ ok: true });
      expect(prueba.body).not.toContain("sk-prueba-1234");

      expect(servidor.peticiones).toHaveLength(1);
      const peticion = servidor.peticiones[0]!;
      expect(peticion.url).toBe("/chat/completions");
      expect(peticion.authorization).toBe("Bearer sk-prueba-1234");
      expect(peticion.agenteUsuario).toBe(`TODO-projects-asistente/${VERSION}`);
      expect(peticion.sesion).toBeNull();
      expect(peticion.cuerpo).toMatchObject({
        model: "modelo-falso",
        max_tokens: 256,
        reasoning_effort: "low",
      });
      expect(peticion.cuerpo.messages).toEqual([
        { role: "user", content: "Responde solo con OK." },
      ]);

      // También con los valores enviados, sin guardarlos antes.
      const directa = await api.probar({
        preset: "personalizado",
        baseUrl: servidor.baseUrl,
        modelo: "otro-modelo",
        clave: "sk-directa-9999",
      });
      expect(directa.json()).toEqual({ ok: true });
      expect(servidor.peticiones).toHaveLength(2);
      expect(servidor.peticiones[1]!.cuerpo).toMatchObject({ model: "otro-modelo" });
      expect(servidor.peticiones[1]!.agenteUsuario).toBe(`TODO-projects-asistente/${VERSION}`);

      // OpenCode Go: sesión aleatoria distinta en cada prueba.
      const primeraGo = await api.probar({
        preset: "opencode-go",
        baseUrl: servidor.baseUrl,
        clave: "sk-go-1111",
      });
      const segundaGo = await api.probar({
        preset: "opencode-go",
        baseUrl: servidor.baseUrl,
        clave: "sk-go-2222",
      });
      expect(primeraGo.json()).toEqual({ ok: true });
      expect(segundaGo.json()).toEqual({ ok: true });
      const sesionGo1 = servidor.peticiones[2]!.sesion;
      const sesionGo2 = servidor.peticiones[3]!.sesion;
      expect(sesionGo1).toMatch(/^[0-9a-f-]{36}$/);
      expect(sesionGo2).toMatch(/^[0-9a-f-]{36}$/);
      expect(sesionGo1).not.toBe(sesionGo2);
    } finally {
      await servidor.cerrar();
    }
  });

  it("da la prueba por buena si el proveedor responde con contenido vacío", async () => {
    const servidor = await crearServidorFalso("vacio");
    try {
      const cookie = await registrar(app, "probar-vacio");
      const api = respuestas(app, cookie);
      const guardado = await api.put({
        preset: "personalizado",
        baseUrl: servidor.baseUrl,
        modelo: "modelo-falso",
        clave: "sk-vacia-4321",
      });
      expect(guardado.statusCode).toBe(200);

      const prueba = await api.probar();
      expect(prueba.statusCode).toBe(200);
      expect(prueba.json()).toEqual({ ok: true });
      expect(prueba.body).not.toContain("Pensando");
      expect(servidor.peticiones).toHaveLength(1);
      expect(servidor.peticiones[0]!.cuerpo.max_tokens).toBe(256);
    } finally {
      await servidor.cerrar();
    }
  });

  it("traduce una clave inválida sin filtrar la clave", async () => {
    const servidor = await crearServidorFalso("401");
    try {
      const cookie = await registrar(app, "probar-401");
      const api = respuestas(app, cookie);
      await api.put({
        preset: "personalizado",
        baseUrl: servidor.baseUrl,
        modelo: "modelo-falso",
        clave: "sk-mala-4321",
      });

      const prueba = await api.probar();
      expect(prueba.statusCode).toBe(200);
      expect(prueba.json()).toEqual({ ok: false, mensaje: "La clave del proveedor no es válida." });
      expect(prueba.body).not.toContain("sk-mala-4321");
    } finally {
      await servidor.cerrar();
    }
  });

  it("traduce el timeout del proveedor", async () => {
    const servidor = await crearServidorFalso("esperar");
    try {
      const cookie = await registrar(app, "probar-timeout");
      const api = respuestas(app, cookie);
      await api.put({
        preset: "personalizado",
        baseUrl: servidor.baseUrl,
        modelo: "modelo-falso",
        clave: "sk-lenta-9876",
      });

      const prueba = await api.probar();
      expect(prueba.json()).toMatchObject({ ok: false });
      expect((prueba.json() as { mensaje: string }).mensaje).toContain("tardado");
    } finally {
      await servidor.cerrar();
    }
  });

  it("no deja probar el proveedor sin configuración", async () => {
    const cookie = await registrar(app, "probar-sin-config");
    const api = respuestas(app, cookie);
    expect((await api.probar()).statusCode).toBe(400);
  });
});
