import { type FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { esquemaExcepcionOcurrencia, expandirOcurrencias } from "@todo/shared";

import { excepcionesOcurrencia } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { registrarHistorial } from "./historial.js";
import { obtenerTareaPropia } from "./tareas.js";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

const esquemaConsulta = z.object({
  fechaOriginal: z.string().datetime({ offset: true }),
});

/** Forma estable de una excepción para el historial y la respuesta. */
interface ExcepcionGuardada {
  fechaOriginal: string;
  fechaNueva: string | null;
  omitida: boolean;
  titulo: string | null;
}

function instantaneaExcepcion(
  fila: typeof excepcionesOcurrencia.$inferSelect | undefined,
): ExcepcionGuardada | null {
  if (!fila) {
    return null;
  }
  return {
    fechaOriginal: fila.fechaOriginal.toISOString(),
    fechaNueva: fila.fechaNueva ? fila.fechaNueva.toISOString() : null,
    omitida: fila.omitida,
    titulo: fila.titulo,
  };
}

/** Misma comprobación que `ocurrencias.ts`: la fecha debe ser de la serie. */
interface TareaConSerie {
  venceEn: Date | null;
  recurrencia: string | null;
  zona: string;
}

function esOcurrenciaDeLaSerie(tarea: TareaConSerie, fecha: Date): boolean {
  if (!tarea.venceEn) {
    return false;
  }

  const ocurrencias = expandirOcurrencias(
    { inicio: tarea.venceEn, recurrencia: tarea.recurrencia, zona: tarea.zona },
    new Date(fecha.getTime() - MILISEGUNDOS_POR_DIA),
    new Date(fecha.getTime() + MILISEGUNDOS_POR_DIA),
  );

  return ocurrencias.some((ocurrencia) => ocurrencia.getTime() === fecha.getTime());
}

export function registrarRutasExcepciones(app: FastifyInstance, db: Database): void {
  // Crea o reemplaza la excepción de una ocurrencia (upsert por tarea+fecha).
  app.put("/tareas/:id/excepciones", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const cuerpo = esquemaExcepcionOcurrencia.safeParse(request.body);
    if (!cuerpo.success) {
      reply.code(400).send({ mensaje: "Datos de excepción no válidos" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const tarea = fila.tarea;
    if (!tarea.recurrencia || !tarea.venceEn) {
      reply.code(400).send({ mensaje: "La tarea no es recurrente" });
      return;
    }

    const fechaOriginal = new Date(cuerpo.data.fechaOriginal);
    if (!esOcurrenciaDeLaSerie(tarea, fechaOriginal)) {
      reply.code(400).send({ mensaje: "La fecha no es una ocurrencia de la tarea" });
      return;
    }

    const [existente] = await db
      .select()
      .from(excepcionesOcurrencia)
      .where(
        and(
          eq(excepcionesOcurrencia.tareaId, tarea.id),
          eq(excepcionesOcurrencia.fechaOriginal, fechaOriginal),
        ),
      )
      .limit(1);

    // PUT reemplaza: lo que no venga en el cuerpo queda vacío.
    const omitida = cuerpo.data.omitida ?? false;
    const fechaNueva = omitida
      ? null
      : cuerpo.data.fechaNueva
        ? new Date(cuerpo.data.fechaNueva)
        : null;
    const titulo = omitida ? null : (cuerpo.data.titulo ?? null);

    const antes = instantaneaExcepcion(existente);
    const despues: ExcepcionGuardada = {
      fechaOriginal: fechaOriginal.toISOString(),
      fechaNueva: fechaNueva ? fechaNueva.toISOString() : null,
      omitida,
      titulo,
    };

    await db.transaction(async (tx) => {
      await tx
        .insert(excepcionesOcurrencia)
        .values({ tareaId: tarea.id, fechaOriginal, fechaNueva, omitida, titulo })
        .onConflictDoUpdate({
          target: [excepcionesOcurrencia.tareaId, excepcionesOcurrencia.fechaOriginal],
          set: { fechaNueva, omitida, titulo },
        });

      if (JSON.stringify(antes) !== JSON.stringify(despues)) {
        await registrarHistorial(tx, {
          tareaId: tarea.id,
          usuarioId: usuario.id,
          tipo: "fecha",
          datos: { fechaOriginal: despues.fechaOriginal, antes, despues },
        });
      }
    });

    reply.code(200).send(despues);
  });

  app.delete("/tareas/:id/excepciones", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const consulta = esquemaConsulta.safeParse(request.query);
    if (!consulta.success) {
      reply.code(400).send({ mensaje: "Fecha original no válida" });
      return;
    }

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const fechaOriginal = new Date(consulta.data.fechaOriginal);
    const [existente] = await db
      .select()
      .from(excepcionesOcurrencia)
      .where(
        and(
          eq(excepcionesOcurrencia.tareaId, fila.tarea.id),
          eq(excepcionesOcurrencia.fechaOriginal, fechaOriginal),
        ),
      )
      .limit(1);

    if (!existente) {
      reply.code(404).send({ mensaje: "No hay excepción para esa ocurrencia" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(excepcionesOcurrencia)
        .where(
          and(
            eq(excepcionesOcurrencia.tareaId, fila.tarea.id),
            eq(excepcionesOcurrencia.fechaOriginal, fechaOriginal),
          ),
        );

      await registrarHistorial(tx, {
        tareaId: fila.tarea.id,
        usuarioId: usuario.id,
        tipo: "fecha",
        datos: {
          fechaOriginal: fechaOriginal.toISOString(),
          antes: instantaneaExcepcion(existente),
          despues: null,
        },
      });
    });

    reply.code(204).send();
  });
}
