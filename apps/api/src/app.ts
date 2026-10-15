import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import type { Database } from "./db/index.js";
import { MENSAJE_DEMASIADOS_INTENTOS, registrarRutasAuth, type LimitesAuth } from "./auth.js";
import { obtenerSesion } from "./auth.js";
import { registrarRutasAgenda } from "./agenda.js";
import { registrarRutasPush } from "./avisos/rutas.js";
import { registrarRutasColumnas } from "./columnas.js";
import { registrarRutasProyectos } from "./proyectos.js";
import { registrarRutasTareas } from "./tareas.js";

export interface OpcionesApp {
  limiteAuth?: {
    max?: number;
    ventanaMs?: number;
    maxPorCorreo?: number;
  };
  vapidPublicKey?: string | null;
}

const MAX_POR_IP = 10;
const VENTANA_LOGIN_MS = 15 * 60 * 1000;
const VENTANA_REGISTRO_MS = 60 * 60 * 1000;
const MAX_POR_CORREO = 5;

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
  app.decorate("requireAuth", async (request, reply) => {
    const fila = await obtenerSesion(db, request.cookies.sesion);
    if (fila === null) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return reply;
    }
    request.usuario = fila.usuario;
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

  registrarRutasAuth(app, db, limiteAuth);
  registrarRutasProyectos(app, db);
  registrarRutasColumnas(app, db);
  registrarRutasTareas(app, db);
  registrarRutasAgenda(app, db);
  registrarRutasPush(app, db, { vapidPublicKey });

  return app;
}
