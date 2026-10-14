import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import type { Database } from "./db/index.js";
import { registrarRutasAuth } from "./auth.js";
import { obtenerSesion } from "./auth.js";
import { registrarRutasProyectos } from "./proyectos.js";
import { registrarRutasTareas } from "./tareas.js";

export async function buildApp(db: Database): Promise<FastifyInstance> {
  const app = Fastify();

  await app.register(cookie);

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

  registrarRutasAuth(app, db);
  registrarRutasProyectos(app, db);
  registrarRutasTareas(app, db);

  return app;
}
