import { and, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { expandirOcurrencias, partesEnZona } from "@todo/shared";

import {
  avisosEnviados,
  excepcionesOcurrencia,
  ocurrenciasHechas,
  proyectos,
  suscripcionesPush,
  tareas,
  usuarios,
} from "../db/schema.js";
import type { Database } from "../db/index.js";
import { SinDestinoError, type Canal, type DestinoAviso, type SuscripcionPush } from "./canal.js";

const VENTANA_RECUPERACION_MS = 60 * 60 * 1000;
const MARGEN_OCURRENCIA_MS = 5 * 60 * 1000;
const MARGEN_BUSQUEDA_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResultadoAvisos {
  enviados: number;
  fallidos: number;
}

function formatearFechaLocal(fecha: Date, zona: string): string {
  const partes = partesEnZona(fecha, zona);
  const dosDigitos = (valor: number) => String(valor).padStart(2, "0");
  return `${dosDigitos(partes.dia)}/${dosDigitos(partes.mes)}/${partes.anio} ${dosDigitos(partes.hora)}:${dosDigitos(partes.minuto)}`;
}

/**
 * Envía los avisos cuya hora cae en (desdeUltimaPasada, ahora], con una ventana
 * de recuperación máxima de una hora tras un reinicio. La deduplicación se hace
 * con la clave única de `avisos_enviados`.
 */
export async function procesarAvisos(
  db: Database,
  ahora: Date,
  desdeUltimaPasada: Date,
  canales: Canal[],
): Promise<ResultadoAvisos> {
  const resultado: ResultadoAvisos = { enviados: 0, fallidos: 0 };
  if (canales.length === 0) {
    return resultado;
  }

  const desde = new Date(
    Math.max(desdeUltimaPasada.getTime(), ahora.getTime() - VENTANA_RECUPERACION_MS),
  );
  const limiteOcurrencia = new Date(ahora.getTime() + MARGEN_BUSQUEDA_MS);
  const limitePrimeraFecha = new Date(desde.getTime() - MARGEN_BUSQUEDA_MS);

  // Una ocurrencia movida puede caer en la ventana aunque su tarea tenga el
  // venceEn por delante del límite; se añaden esas tareas a la consulta.
  const excepcionesFuturas = await db
    .selectDistinct({ tareaId: excepcionesOcurrencia.tareaId })
    .from(excepcionesOcurrencia)
    .where(
      and(
        isNotNull(excepcionesOcurrencia.fechaNueva),
        gte(excepcionesOcurrencia.fechaNueva, limitePrimeraFecha),
        lte(excepcionesOcurrencia.fechaNueva, limiteOcurrencia),
      ),
    );
  const idsConExcepcionFutura = excepcionesFuturas.map((fila) => fila.tareaId);

  const filas = await db
    .select({
      tareaId: tareas.id,
      titulo: tareas.titulo,
      venceEn: tareas.venceEn,
      recurrencia: tareas.recurrencia,
      zona: tareas.zona,
      recordatorioMin: tareas.recordatorioMin,
      proyectoId: proyectos.id,
      proyectoNombre: proyectos.nombre,
      usuarioId: usuarios.id,
      usuarioEmail: usuarios.email,
      usuarioNombre: usuarios.nombre,
    })
    .from(tareas)
    .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
    .innerJoin(usuarios, eq(proyectos.propietarioId, usuarios.id))
    .where(
      and(
        isNotNull(tareas.venceEn),
        isNotNull(tareas.recordatorioMin),
        or(
          and(
            lte(tareas.venceEn, limiteOcurrencia),
            or(isNotNull(tareas.recurrencia), gte(tareas.venceEn, limitePrimeraFecha)),
          ),
          idsConExcepcionFutura.length > 0
            ? inArray(tareas.id, idsConExcepcionFutura)
            : sql`false`,
        ),
      ),
    );

  if (filas.length === 0) {
    return resultado;
  }

  const idsUsuarios = [...new Set(filas.map((fila) => fila.usuarioId))];
  const suscripciones = await db
    .select({
      usuarioId: suscripcionesPush.usuarioId,
      endpoint: suscripcionesPush.endpoint,
      p256dh: suscripcionesPush.p256dh,
      auth: suscripcionesPush.auth,
    })
    .from(suscripcionesPush)
    .where(inArray(suscripcionesPush.usuarioId, idsUsuarios));

  const pushPorUsuario = new Map<string, SuscripcionPush[]>();
  for (const suscripcion of suscripciones) {
    const lista = pushPorUsuario.get(suscripcion.usuarioId) ?? [];
    lista.push({
      endpoint: suscripcion.endpoint,
      p256dh: suscripcion.p256dh,
      auth: suscripcion.auth,
    });
    pushPorUsuario.set(suscripcion.usuarioId, lista);
  }

  // Una sola consulta por lote para saber qué ocurrencias están marcadas.
  const idsTareas = [...new Set(filas.map((fila) => fila.tareaId))];
  const marcas = new Set<string>();
  const hechas = await db
    .select({ tareaId: ocurrenciasHechas.tareaId, ocurrencia: ocurrenciasHechas.ocurrencia })
    .from(ocurrenciasHechas)
    .where(inArray(ocurrenciasHechas.tareaId, idsTareas));
  for (const marca of hechas) {
    marcas.add(`${marca.tareaId}|${marca.ocurrencia.getTime()}`);
  }

  // Excepciones de esas tareas: una omitida no avisa y una movida avisa con su
  // fecha nueva (aunque la original quede fuera de la ventana).
  const excepciones = await db
    .select({
      tareaId: excepcionesOcurrencia.tareaId,
      fechaOriginal: excepcionesOcurrencia.fechaOriginal,
      fechaNueva: excepcionesOcurrencia.fechaNueva,
      omitida: excepcionesOcurrencia.omitida,
    })
    .from(excepcionesOcurrencia)
    .where(inArray(excepcionesOcurrencia.tareaId, idsTareas));

  const excepcionesPorTarea = new Map<
    string,
    Map<number, { fechaNueva: Date | null; omitida: boolean }>
  >();
  for (const excepcion of excepciones) {
    let porTarea = excepcionesPorTarea.get(excepcion.tareaId);
    if (!porTarea) {
      porTarea = new Map();
      excepcionesPorTarea.set(excepcion.tareaId, porTarea);
    }
    porTarea.set(excepcion.fechaOriginal.getTime(), {
      fechaNueva: excepcion.fechaNueva,
      omitida: excepcion.omitida,
    });
  }

  for (const fila of filas) {
    if (!fila.venceEn || fila.recordatorioMin === null) {
      continue;
    }

    const recordatorioMs = fila.recordatorioMin * 60 * 1000;
    const desdeOcurrencia = new Date(desde.getTime() + recordatorioMs);
    const hastaOcurrencia = new Date(ahora.getTime() + recordatorioMs);

    const excepcionesTarea = excepcionesPorTarea.get(fila.tareaId);
    const candidatas = new Map<number, Date>();
    for (const ocurrencia of expandirOcurrencias(
      { inicio: fila.venceEn, recurrencia: fila.recurrencia, zona: fila.zona },
      desdeOcurrencia,
      hastaOcurrencia,
    )) {
      candidatas.set(ocurrencia.getTime(), ocurrencia);
    }
    if (excepcionesTarea) {
      for (const ms of excepcionesTarea.keys()) {
        if (!candidatas.has(ms)) {
          candidatas.set(ms, new Date(ms));
        }
      }
    }

    for (const [originalMs, original] of candidatas) {
      const excepcion = excepcionesTarea?.get(originalMs);
      if (excepcion?.omitida) {
        continue;
      }

      // El aviso usa la fecha efectiva: la nueva si la ocurrencia se movió.
      const ocurrencia = excepcion?.fechaNueva ?? original;
      if (
        ocurrencia.getTime() < desdeOcurrencia.getTime() ||
        ocurrencia.getTime() > hastaOcurrencia.getTime()
      ) {
        continue;
      }
      if (marcas.has(`${fila.tareaId}|${originalMs}`)) {
        continue;
      }
      if (ocurrencia.getTime() < ahora.getTime() - MARGEN_OCURRENCIA_MS) {
        continue;
      }

      const destino: DestinoAviso = {
        usuario: {
          id: fila.usuarioId,
          email: fila.usuarioEmail,
          nombre: fila.usuarioNombre,
        },
        suscripcionesPush: pushPorUsuario.get(fila.usuarioId) ?? [],
      };

      const aviso = {
        titulo: `Recordatorio: ${fila.titulo}`,
        cuerpo: `La tarea "${fila.titulo}" vence el ${formatearFechaLocal(ocurrencia, fila.zona)} (proyecto ${fila.proyectoNombre}).`,
        urlRelativa: `/proyectos/${fila.proyectoId}`,
      };

      for (const canal of canales) {
        const [insertado] = await db
          .insert(avisosEnviados)
          .values({ tareaId: fila.tareaId, ocurrencia, canal: canal.id })
          .onConflictDoNothing({
            target: [avisosEnviados.tareaId, avisosEnviados.ocurrencia, avisosEnviados.canal],
          })
          .returning({ id: avisosEnviados.id });

        if (!insertado) {
          continue;
        }

        try {
          await canal.enviar(destino, aviso);
          resultado.enviados += 1;
        } catch (error) {
          await db.delete(avisosEnviados).where(eq(avisosEnviados.id, insertado.id));
          if (!(error instanceof SinDestinoError)) {
            resultado.fallidos += 1;
          }
        }
      }
    }
  }

  return resultado;
}
