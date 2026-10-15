import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";

import { expandirOcurrencias, partesEnZona } from "@todo/shared";

import { avisosEnviados, proyectos, suscripcionesPush, tareas, usuarios } from "../db/schema.js";
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
        lte(tareas.venceEn, limiteOcurrencia),
        or(isNotNull(tareas.recurrencia), gte(tareas.venceEn, limitePrimeraFecha)),
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

  for (const fila of filas) {
    if (!fila.venceEn || fila.recordatorioMin === null) {
      continue;
    }

    const recordatorioMs = fila.recordatorioMin * 60 * 1000;
    const desdeOcurrencia = new Date(desde.getTime() + recordatorioMs);
    const hastaOcurrencia = new Date(ahora.getTime() + recordatorioMs);

    const ocurrencias = expandirOcurrencias(
      { inicio: fila.venceEn, recurrencia: fila.recurrencia, zona: fila.zona },
      desdeOcurrencia,
      hastaOcurrencia,
    );

    for (const ocurrencia of ocurrencias) {
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
