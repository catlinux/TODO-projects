import { type FastifyInstance } from "fastify";
import { and, asc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  expandirOcurrencias,
  generarCalendarioIcs,
  type ExcepcionIcs,
} from "@todo/shared";

import { columnas, excepcionesOcurrencia, ocurrenciasHechas, proyectos, tareas } from "./db/schema.js";
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
  /** Columna de menor `posicion` del proyecto (destino al desmarcar). */
  primeraColumnaId: string;
  /** Columna de mayor `posicion` del proyecto: estar en ella es estar «hecha». */
  ultimaColumnaId: string;
  /** Fecha efectiva (la nueva si la ocurrencia se movió). */
  fecha: string;
  /** Fecha original de la serie; clave de la ocurrencia y de `ocurrencias_hechas`. */
  fechaOriginal: string;
  conExcepcion: boolean;
  esRecurrente: boolean;
  hecha: boolean;
  recordatorioMin: number | null;
}

interface ExcepcionCargada {
  fechaNueva: Date | null;
  omitida: boolean;
  titulo: string | null;
}

function agruparExcepciones(
  filas: Array<{
    tareaId: string;
    fechaOriginal: Date;
    fechaNueva: Date | null;
    omitida: boolean;
    titulo: string | null;
  }>,
): Map<string, Map<number, ExcepcionCargada>> {
  const porTarea = new Map<string, Map<number, ExcepcionCargada>>();
  for (const fila of filas) {
    let excepciones = porTarea.get(fila.tareaId);
    if (!excepciones) {
      excepciones = new Map();
      porTarea.set(fila.tareaId, excepciones);
    }
    excepciones.set(fila.fechaOriginal.getTime(), {
      fechaNueva: fila.fechaNueva,
      omitida: fila.omitida,
      titulo: fila.titulo,
    });
  }
  return porTarea;
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

    // Excepciones del usuario que tocan el rango: una ocurrencia movida puede
    // caer dentro aunque su fecha original quede fuera (y al revés). Se cargan
    // antes para saber qué tareas hay que traer además de las del rango.
    const excepciones = await db
      .select({
        tareaId: excepcionesOcurrencia.tareaId,
        fechaOriginal: excepcionesOcurrencia.fechaOriginal,
        fechaNueva: excepcionesOcurrencia.fechaNueva,
        omitida: excepcionesOcurrencia.omitida,
        titulo: excepcionesOcurrencia.titulo,
      })
      .from(excepcionesOcurrencia)
      .innerJoin(tareas, eq(excepcionesOcurrencia.tareaId, tareas.id))
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .where(
        and(
          eq(proyectos.propietarioId, usuario.id),
          or(
            and(
              gte(excepcionesOcurrencia.fechaOriginal, desde),
              lte(excepcionesOcurrencia.fechaOriginal, hasta),
            ),
            and(
              gte(excepcionesOcurrencia.fechaNueva, desde),
              lte(excepcionesOcurrencia.fechaNueva, hasta),
            ),
          ),
        ),
      );

    const excepcionesPorTarea = agruparExcepciones(excepciones);
    const idsConExcepcion = [...excepcionesPorTarea.keys()];

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
        recordatorioMin: tareas.recordatorioMin,
      })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .innerJoin(columnas, eq(tareas.columnaId, columnas.id))
      .where(
        and(
          eq(proyectos.propietarioId, usuario.id),
          isNotNull(tareas.venceEn),
          or(
            and(
              lte(tareas.venceEn, hasta),
              or(isNotNull(tareas.recurrencia), gte(tareas.venceEn, desde)),
            ),
            idsConExcepcion.length > 0 ? inArray(tareas.id, idsConExcepcion) : sql`false`,
          ),
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

    // Primera y última columna de cada proyecto en una sola consulta. Si el
    // proyecto tiene una sola columna, primera = última y toda tarea no
    // recurrente cuenta como hecha.
    const idsProyectos = [...new Set(filas.map((fila) => fila.proyectoId))];
    const limitesColumnas = new Map<string, { primera: string; ultima: string }>();
    if (idsProyectos.length > 0) {
      const columnasProyecto = await db
        .select({ id: columnas.id, proyectoId: columnas.proyectoId })
        .from(columnas)
        .where(inArray(columnas.proyectoId, idsProyectos))
        .orderBy(asc(columnas.posicion));

      for (const columna of columnasProyecto) {
        const limites = limitesColumnas.get(columna.proyectoId);
        if (limites) {
          limites.ultima = columna.id;
        } else {
          limitesColumnas.set(columna.proyectoId, { primera: columna.id, ultima: columna.id });
        }
      }
    }

    const ocurrencias: OcurrenciaAgenda[] = [];

    for (const fila of filas) {
      if (!fila.venceEn) {
        continue;
      }

      const excepcionesTarea = excepcionesPorTarea.get(fila.tareaId);
      const candidatas = new Map<number, Date>();
      for (const fecha of expandirOcurrencias(
        { inicio: fila.venceEn, recurrencia: fila.recurrencia, zona: fila.zona },
        desde,
        hasta,
      )) {
        candidatas.set(fecha.getTime(), fecha);
      }
      if (excepcionesTarea) {
        for (const ms of excepcionesTarea.keys()) {
          if (!candidatas.has(ms)) {
            candidatas.set(ms, new Date(ms));
          }
        }
      }

      const limites = limitesColumnas.get(fila.proyectoId);
      const primeraColumnaId = limites?.primera ?? fila.columnaId;
      const ultimaColumnaId = limites?.ultima ?? fila.columnaId;
      const esRecurrente = fila.recurrencia !== null;
      const enUltimaColumna = fila.columnaId === ultimaColumnaId;

      for (const original of candidatas.values()) {
        const excepcion = excepcionesTarea?.get(original.getTime());
        if (excepcion?.omitida) {
          continue;
        }

        const efectiva = excepcion?.fechaNueva ?? original;
        if (efectiva.getTime() < desde.getTime() || efectiva.getTime() > hasta.getTime()) {
          continue;
        }

        ocurrencias.push({
          tareaId: fila.tareaId,
          titulo: excepcion?.titulo ?? fila.titulo,
          proyectoId: fila.proyectoId,
          proyectoNombre: fila.proyectoNombre,
          columnaId: fila.columnaId,
          columnaNombre: fila.columnaNombre,
          primeraColumnaId,
          ultimaColumnaId,
          fecha: efectiva.toISOString(),
          fechaOriginal: original.toISOString(),
          conExcepcion: excepcion !== undefined,
          esRecurrente,
          hecha:
            marcas.has(`${fila.tareaId}|${original.getTime()}`) || (!esRecurrente && enUltimaColumna),
          recordatorioMin: fila.recordatorioMin,
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

    const idsTareas = filas.map((fila) => fila.id);
    const excepcionesPorTarea = new Map<string, ExcepcionIcs[]>();
    if (idsTareas.length > 0) {
      const excepciones = await db
        .select({
          tareaId: excepcionesOcurrencia.tareaId,
          fechaOriginal: excepcionesOcurrencia.fechaOriginal,
          fechaNueva: excepcionesOcurrencia.fechaNueva,
          omitida: excepcionesOcurrencia.omitida,
          titulo: excepcionesOcurrencia.titulo,
        })
        .from(excepcionesOcurrencia)
        .where(inArray(excepcionesOcurrencia.tareaId, idsTareas));

      for (const excepcion of excepciones) {
        const lista = excepcionesPorTarea.get(excepcion.tareaId) ?? [];
        lista.push({
          fechaOriginal: excepcion.fechaOriginal,
          fechaNueva: excepcion.fechaNueva,
          omitida: excepcion.omitida,
          titulo: excepcion.titulo,
        });
        excepcionesPorTarea.set(excepcion.tareaId, lista);
      }
    }

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
              excepciones: excepcionesPorTarea.get(fila.id) ?? [],
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
