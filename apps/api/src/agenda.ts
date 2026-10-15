import { type FastifyInstance } from "fastify";
import { and, asc, eq, gte, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import { expandirOcurrencias } from "@todo/shared";

import { columnas, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;
const DIAS_MAXIMOS = 366;
const TOPE_OCURRENCIAS = 2000;

const esquemaConsulta = z.object({
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
});

interface OcurrenciaAgenda {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  columnaId: string;
  columnaNombre: string;
  fecha: string;
  esRecurrente: boolean;
}

export function registrarRutasAgenda(app: FastifyInstance, db: Database): void {
  app.get("/agenda", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const consulta = esquemaConsulta.safeParse(request.query);
    if (!consulta.success) {
      reply.code(400).send({ mensaje: "Parámetros de agenda no válidos" });
      return;
    }

    const desde = new Date(consulta.data.desde);
    const hasta = new Date(consulta.data.hasta);

    if (desde.getTime() > hasta.getTime()) {
      reply.code(400).send({ mensaje: "El rango de fechas no es válido" });
      return;
    }

    if (hasta.getTime() - desde.getTime() > DIAS_MAXIMOS * MILISEGUNDOS_POR_DIA) {
      reply.code(400).send({ mensaje: "El rango no puede superar los 366 días" });
      return;
    }

    const filas = await db
      .select({
        tareaId: tareas.id,
        titulo: tareas.titulo,
        proyectoId: proyectos.id,
        proyectoNombre: proyectos.nombre,
        columnaId: columnas.id,
        columnaNombre: columnas.nombre,
        venceEn: tareas.venceEn,
        recurrencia: tareas.recurrencia,
      })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .innerJoin(columnas, eq(tareas.columnaId, columnas.id))
      .where(
        and(
          eq(proyectos.propietarioId, usuario.id),
          isNotNull(tareas.venceEn),
          lte(tareas.venceEn, hasta),
          or(isNotNull(tareas.recurrencia), gte(tareas.venceEn, desde)),
        ),
      )
      .orderBy(asc(tareas.venceEn));

    const ocurrencias: OcurrenciaAgenda[] = [];

    for (const fila of filas) {
      if (!fila.venceEn) {
        continue;
      }

      const fechas = expandirOcurrencias(
        { inicio: fila.venceEn, recurrencia: fila.recurrencia },
        desde,
        hasta,
      );

      for (const fecha of fechas) {
        ocurrencias.push({
          tareaId: fila.tareaId,
          titulo: fila.titulo,
          proyectoId: fila.proyectoId,
          proyectoNombre: fila.proyectoNombre,
          columnaId: fila.columnaId,
          columnaNombre: fila.columnaNombre,
          fecha: fecha.toISOString(),
          esRecurrente: fila.recurrencia !== null,
        });
      }
    }

    ocurrencias.sort((a, b) => {
      const comparacion = a.fecha.localeCompare(b.fecha);
      return comparacion !== 0 ? comparacion : a.tareaId.localeCompare(b.tareaId);
    });

    return ocurrencias.slice(0, TOPE_OCURRENCIAS);
  });
}
