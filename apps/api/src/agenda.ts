import { type FastifyInstance } from "fastify";
import { and, asc, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import { z } from "zod";

import { expandirOcurrencias, generarCalendarioIcs } from "@todo/shared";

import { columnas, ocurrenciasHechas, proyectos, tareas } from "./db/schema.js";
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
  hecha: boolean;
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
        zona: tareas.zona,
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

    const idsTareas = [...new Set(filas.map((fila) => fila.tareaId))];
    const marcas = new Set<string>();
    if (idsTareas.length > 0) {
      const hechas = await db
        .select({ tareaId: ocurrenciasHechas.tareaId, ocurrencia: ocurrenciasHechas.ocurrencia })
        .from(ocurrenciasHechas)
        .where(inArray(ocurrenciasHechas.tareaId, idsTareas));
      for (const marca of hechas) {
        marcas.add(`${marca.tareaId}|${marca.ocurrencia.getTime()}`);
      }
    }

    const ocurrencias: OcurrenciaAgenda[] = [];

    for (const fila of filas) {
      if (!fila.venceEn) {
        continue;
      }

      const fechas = expandirOcurrencias(
        { inicio: fila.venceEn, recurrencia: fila.recurrencia, zona: fila.zona },
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
          hecha: marcas.has(`${fila.tareaId}|${fecha.getTime()}`),
        });
      }
    }

    ocurrencias.sort((a, b) => {
      const comparacion = a.fecha.localeCompare(b.fecha);
      return comparacion !== 0 ? comparacion : a.tareaId.localeCompare(b.tareaId);
    });

    return ocurrencias.slice(0, TOPE_OCURRENCIAS);
  });

  app.get("/agenda.ics", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const filas = await db
      .select({
        id: tareas.id,
        titulo: tareas.titulo,
        descripcion: tareas.descripcion,
        venceEn: tareas.venceEn,
        recurrencia: tareas.recurrencia,
        zona: tareas.zona,
        proyectoNombre: proyectos.nombre,
      })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .where(and(eq(proyectos.propietarioId, usuario.id), isNotNull(tareas.venceEn)))
      .orderBy(asc(tareas.venceEn));

    const eventos = filas.flatMap((fila) =>
      fila.venceEn
        ? [
            {
              uid: fila.id,
              titulo: fila.titulo,
              descripcion: fila.descripcion,
              inicio: fila.venceEn,
              recurrencia: fila.recurrencia,
              zona: fila.zona,
              proyecto: fila.proyectoNombre,
            },
          ]
        : [],
    );

    const calendario = generarCalendarioIcs(eventos);

    reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="todo-projects.ics"');

    return calendario;
  });
}
