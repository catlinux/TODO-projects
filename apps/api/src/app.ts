import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import type { Database } from "./db/index.js";
import { crearBloqueoGlobal, registrarRutasAcceso } from "./acceso.js";
import { MENSAJE_DEMASIADOS_INTENTOS, registrarRutasAuth, type LimitesAuth } from "./auth.js";
import { obtenerSesion } from "./auth.js";
import { registrarRutasAgenda } from "./agenda.js";
import { registrarRutasActividad } from "./actividad.js";
import { registrarRutasPush } from "./avisos/rutas.js";
import { registrarRutasColumnas } from "./columnas.js";
import { registrarRutasOcurrencias } from "./ocurrencias.js";
import { registrarRutasProyectos } from "./proyectos.js";
import { registrarRutasTareas } from "./tareas.js";
import { configDesdeOrigen } from "./webauthn.js";
import { buscarTokenApi, crearLimiteFallosTokens, registrarRutasTokens } from "./tokens.js";

export interface OpcionesApp {
  limiteAuth?: {
    max?: number;
    ventanaMs?: number;
    maxPorCorreo?: number;
  };
  limiteTokens?: {
    max?: number;
    ventanaMs?: number;
  };
  vapidPublicKey?: string | null;
  /** Si es false, /auth/registro responde 403. Por defecto, REGISTRO_ABIERTO distinto de "0". */
  registroAbierto?: boolean;
  /** Si es false, /auth/login (correo) responde 403. Por defecto, ACCESO_CORREO distinto de "0". */
  accesoCorreo?: boolean;
  /** Origen público (https://dominio) que activa las passkeys. Por defecto, ORIGEN_PUBLICO. */
  origenPublico?: string | null;
  bloqueoPin?: ReturnType<typeof crearBloqueoGlobal>;
}

const MAX_POR_IP = 10;
const VENTANA_LOGIN_MS = 15 * 60 * 1000;
const VENTANA_REGISTRO_MS = 60 * 60 * 1000;
const MAX_POR_CORREO = 5;
const MAX_FALLOS_TOKEN = 30;
const VENTANA_FALLOS_TOKEN_MS = 15 * 60 * 1000;

const RUTAS_PROHIBIDAS_ESCRITURA = ["/tokens", "/auth", "/push"];

function extraerTokenPeticion(request: {
  headers: Record<string, unknown>;
  routeOptions: { url: string | undefined };
  query: unknown;
}): string | null {
  const cabecera = request.headers.authorization;
  if (typeof cabecera === "string" && cabecera.startsWith("Bearer ")) {
    const token = cabecera.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }

  if (request.routeOptions.url === "/agenda.ics") {
    const consulta = request.query as { token?: unknown } | undefined;
    if (consulta && typeof consulta.token === "string" && consulta.token.length > 0) {
      return consulta.token;
    }
  }

  return null;
}

function permisoPermite(
  permiso: "lectura" | "escritura" | "calendario",
  metodo: string,
  ruta: string,
): boolean {
  if (permiso === "calendario") {
    return metodo === "GET" && ruta === "/agenda.ics";
  }
  if (permiso === "lectura") {
    return metodo === "GET" || metodo === "HEAD";
  }
  return !RUTAS_PROHIBIDAS_ESCRITURA.some((prefijo) => ruta.startsWith(prefijo));
}

export async function buildApp(db: Database, opciones: OpcionesApp = {}): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: process.env.TRUST_PROXY === "1" });

  const limiteAuth: LimitesAuth = {
    login: {
      max: opciones.limiteAuth?.max ?? MAX_POR_IP,
      ventanaMs: opciones.limiteAuth?.ventanaMs ?? VENTANA_LOGIN_MS,
    },
    registro: {
      max: opciones.limiteAuth?.max ?? MAX_POR_IP,
      ventanaMs: opciones.limiteAuth?.ventanaMs ?? VENTANA_REGISTRO_MS,
    },
    maxPorCorreo: opciones.limiteAuth?.maxPorCorreo ?? MAX_POR_CORREO,
  };

  const vapidPublicKey =
    opciones.vapidPublicKey !== undefined
      ? opciones.vapidPublicKey
      : (process.env.VAPID_PUBLIC_KEY ?? null);

  const limiteTokens = crearLimiteFallosTokens(
    opciones.limiteTokens?.max ?? MAX_FALLOS_TOKEN,
    opciones.limiteTokens?.ventanaMs ?? VENTANA_FALLOS_TOKEN_MS,
  );

  await app.register(cookie);
  // global:false: solo se aplica a las rutas que declaran su propio rateLimit.
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => {
      const respuesta: { mensaje: string; statusCode?: number } = {
        mensaje: MENSAJE_DEMASIADOS_INTENTOS,
      };
      // No enumerable para que el cuerpo sea solo {mensaje} y el estado sea 429.
      Object.defineProperty(respuesta, "statusCode", { value: 429 });
      return respuesta;
    },
  });

  app.decorateRequest("usuario", null);
  app.decorateRequest("permisoToken", null);
  app.decorateRequest("tokenId", null);
  app.decorateRequest("tokenNombre", null);
  app.decorate("requireAuth", async (request, reply) => {
    const porCookie = await obtenerSesion(db, request.cookies.sesion);
    if (porCookie) {
      request.usuario = porCookie.usuario;
      request.permisoToken = null;
      request.tokenId = null;
      request.tokenNombre = null;
      return;
    }

    const token = extraerTokenPeticion(request);
    if (token) {
      const espera = limiteTokens.segundosBloqueado(request.ip);
      if (espera > 0) {
        reply
          .code(429)
          .header("Retry-After", espera)
          .send({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
        return reply;
      }

      const valido = await buscarTokenApi(db, token);
      if (valido) {
        const ruta = request.routeOptions.url ?? request.url;
        if (!permisoPermite(valido.permiso, request.method, ruta)) {
          reply.code(403).send({ mensaje: "El token no tiene permiso para esta acción" });
          return reply;
        }
        request.usuario = valido.usuario;
        request.permisoToken = valido.permiso;
        request.tokenId = valido.id;
        request.tokenNombre = valido.nombre;
        return;
      }

      const bloqueo = limiteTokens.registrarFallo(request.ip);
      if (bloqueo > 0) {
        reply
          .code(429)
          .header("Retry-After", bloqueo)
          .send({ mensaje: MENSAJE_DEMASIADOS_INTENTOS });
        return reply;
      }
    }

    reply.code(401).send({ mensaje: "No autenticado" });
    return reply;
  });

  app.get("/salud", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { estado: "ok", baseDatos: "ok" };
    } catch {
      reply.code(503);
      return { estado: "error", baseDatos: "error" };
    }
  });

  const registroAbierto = opciones.registroAbierto ?? process.env.REGISTRO_ABIERTO !== "0";
  const accesoCorreo = opciones.accesoCorreo ?? process.env.ACCESO_CORREO !== "0";
  const origenPublico =
    opciones.origenPublico !== undefined
      ? opciones.origenPublico
      : process.env.ORIGEN_PUBLICO || null;

  registrarRutasAuth(app, db, limiteAuth, registroAbierto, accesoCorreo);
  registrarRutasAcceso(app, db, {
    limites: limiteAuth,
    accesoCorreo,
    registroAbierto,
    webauthn: origenPublico ? configDesdeOrigen(origenPublico) : null,
    ...(opciones.bloqueoPin ? { bloqueo: opciones.bloqueoPin } : {}),
  });
  registrarRutasTokens(app, db);
  registrarRutasProyectos(app, db);
  registrarRutasColumnas(app, db);
  registrarRutasTareas(app, db);
  registrarRutasOcurrencias(app, db);
  registrarRutasAgenda(app, db);
  registrarRutasActividad(app, db);
  registrarRutasPush(app, db, { vapidPublicKey });

  return app;
}
