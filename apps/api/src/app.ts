import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";

import type { Database } from "./db/index.js";

export async function buildApp(db: Database): Promise<FastifyInstance> {
  const app = Fastify();

  app.get("/salud", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { estado: "ok", baseDatos: "ok" };
    } catch {
      reply.code(503);
      return { estado: "error", baseDatos: "error" };
    }
  });

  return app;
}
