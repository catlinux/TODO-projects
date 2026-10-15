import { type FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { expandirOcurrencias } from "@todo/shared";

import { ocurrenciasHechas } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { obtenerTareaPropia } from "./tareas.js";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

const esquemaCuerpo = z.object({
  fecha: z.string().datetime({ offset: true }),
  hecha: z.boolean(),
});

export function registrarRutasOcurrencias(app: FastifyInstance, db: Database): void {
  app.post("/tareas/:id/ocurrencias", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const params = esquemaId.safeParse(request.params);
    if (!params.success) {
      reply.code(400).send({ mensaje: "Identificador no válido" });
      return;
    }

    const cuerpo = esquemaCuerpo.safeParse(request.body);
    if (!cuerpo.success) {
      reply.code(400).send({ mensaje: "Datos de ocurrencia no válidos" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const tarea = fila.tarea;
    const fecha = new Date(cuerpo.data.fecha);

    if (!tarea.venceEn) {
      reply.code(400).send({ mensaje: "La fecha no es una ocurrencia de la tarea" });
      return;
    }

    const ocurrencias = expandirOcurrencias(
      { inicio: tarea.venceEn, recurrencia: tarea.recurrencia, zona: tarea.zona },
      new Date(fecha.getTime() - MILISEGUNDOS_POR_DIA),
      new Date(fecha.getTime() + MILISEGUNDOS_POR_DIA),
    );

    const coincide = ocurrencias.some((ocurrencia) => ocurrencia.getTime() === fecha.getTime());
    if (!coincide) {
      reply.code(400).send({ mensaje: "La fecha no es una ocurrencia de la tarea" });
      return;
    }

    if (cuerpo.data.hecha) {
      await db
        .insert(ocurrenciasHechas)
        .values({ tareaId: tarea.id, ocurrencia: fecha })
        .onConflictDoNothing({
          target: [ocurrenciasHechas.tareaId, ocurrenciasHechas.ocurrencia],
        });
    } else {
      await db
        .delete(ocurrenciasHechas)
        .where(
          and(eq(ocurrenciasHechas.tareaId, tarea.id), eq(ocurrenciasHechas.ocurrencia, fecha)),
        );
    }

    reply.code(204).send();
  });
}
