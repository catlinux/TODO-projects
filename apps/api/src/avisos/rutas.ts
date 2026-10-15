import { type FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { suscripcionesPush } from "../db/schema.js";
import type { Database } from "../db/index.js";

export interface ConfigPushRutas {
  vapidPublicKey: string | null;
}

const esquemaEndpoint = z
  .url("Endpoint no válido")
  .max(2048)
  .refine((valor) => valor.startsWith("https://"), "El endpoint debe usar https");

const esquemaSuscripcion = z.object({
  endpoint: esquemaEndpoint,
  keys: z.object({
    p256dh: z.string().min(1, "Clave p256dh obligatoria").max(256, "Clave p256dh demasiado larga"),
    auth: z.string().min(1, "Clave auth obligatoria").max(256, "Clave auth demasiado larga"),
  }),
});

const esquemaBaja = z.object({
  endpoint: esquemaEndpoint,
});

export function registrarRutasPush(
  app: FastifyInstance,
  db: Database,
  config: ConfigPushRutas,
): void {
  app.get("/push/clave", { preHandler: app.requireAuth }, async (request, reply) => {
    if (!request.usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    if (!config.vapidPublicKey) {
      reply.code(404).send({ mensaje: "Avisos push no configurados" });
      return;
    }

    return { clave: config.vapidPublicKey };
  });

  app.post("/push/suscripcion", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const cuerpo = esquemaSuscripcion.safeParse(request.body);
    if (!cuerpo.success) {
      reply.code(400).send({ mensaje: "Suscripción push no válida" });
      return;
    }

    const { endpoint, keys } = cuerpo.data;
    await db
      .insert(suscripcionesPush)
      .values({ usuarioId: usuario.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: suscripcionesPush.endpoint,
        set: {
          usuarioId: usuario.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
          updatedAt: new Date(),
        },
      });

    reply.code(204).send();
  });

  app.delete("/push/suscripcion", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const cuerpo = esquemaBaja.safeParse(request.body);
    if (!cuerpo.success) {
      reply.code(400).send({ mensaje: "Suscripción push no válida" });
      return;
    }

    await db
      .delete(suscripcionesPush)
      .where(
        and(
          eq(suscripcionesPush.endpoint, cuerpo.data.endpoint),
          eq(suscripcionesPush.usuarioId, usuario.id),
        ),
      );

    reply.code(204).send();
  });
}
