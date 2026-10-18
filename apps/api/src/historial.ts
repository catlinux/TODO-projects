import { type FastifyInstance } from "fastify";
import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { comentarios, historialTarea, usuarios } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { obtenerTareaPropia } from "./tareas.js";

const esquemaId = z.object({ id: z.string().uuid("Identificador no válido") });

export const TIPOS_HISTORIAL = [
  "creada",
  "movida",
  "fecha",
  "etiqueta",
  "checklist",
  "portada",
  "adjunto",
  "proyecto",
] as const;

export type TipoHistorial = (typeof TIPOS_HISTORIAL)[number];

export interface EntradaHistorial {
  tareaId: string;
  usuarioId: string;
  tipo: TipoHistorial;
  datos: Record<string, unknown>;
}

/** Admite tanto la base de datos como una transacción en curso. */
type Ejecutor = Pick<Database, "insert">;

export async function registrarHistorial(
  ejecutor: Ejecutor,
  entrada: EntradaHistorial,
): Promise<void> {
  await ejecutor.insert(historialTarea).values({
    tareaId: entrada.tareaId,
    usuarioId: entrada.usuarioId,
    tipo: entrada.tipo,
    datos: entrada.datos,
  });
}

const POR_PAGINA = 50;

export function registrarRutasHistorial(app: FastifyInstance, db: Database): void {
  app.get("/tareas/:id/actividad", { preHandler: app.requireAuth }, async (request, reply) => {
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

    const fila = await obtenerTareaPropia(db, params.data.id, usuario.id);
    if (!fila) {
      reply.code(404).send({ mensaje: "Tarea no encontrada" });
      return;
    }

    const consulta = request.query as { pagina?: unknown } | undefined;
    const pagina = Math.max(1, Number.parseInt(String(consulta?.pagina ?? "1"), 10) || 1);
    const limite = pagina * POR_PAGINA;

    const filasComentarios = await db
      .select({
        id: comentarios.id,
        usuarioId: comentarios.usuarioId,
        usuarioNombre: usuarios.nombre,
        creadoEn: comentarios.createdAt,
        texto: comentarios.texto,
      })
      .from(comentarios)
      .innerJoin(usuarios, eq(comentarios.usuarioId, usuarios.id))
      .where(eq(comentarios.tareaId, params.data.id))
      .orderBy(desc(comentarios.createdAt), desc(comentarios.id))
      .limit(limite);

    const filasHistorial = await db
      .select({
        id: historialTarea.id,
        usuarioId: historialTarea.usuarioId,
        usuarioNombre: usuarios.nombre,
        creadoEn: historialTarea.createdAt,
        historialTipo: historialTarea.tipo,
        datos: historialTarea.datos,
      })
      .from(historialTarea)
      .innerJoin(usuarios, eq(historialTarea.usuarioId, usuarios.id))
      .where(eq(historialTarea.tareaId, params.data.id))
      .orderBy(desc(historialTarea.createdAt), desc(historialTarea.id))
      .limit(limite);

    // Se piden `pagina * 50` de cada tipo y luego se fusionan por fecha: el
    // resultado contiene la página pedida de la unión sin traerla entera.
    const elementos = [
      ...filasComentarios.map((filaComentario) => ({
        orden: filaComentario.creadoEn.getTime(),
        elemento: {
          tipo: "comentario" as const,
          id: filaComentario.id,
          usuarioId: filaComentario.usuarioId,
          usuarioNombre: filaComentario.usuarioNombre,
          creadoEn: filaComentario.creadoEn.toISOString(),
          texto: filaComentario.texto,
        },
      })),
      ...filasHistorial.map((filaHistorial) => ({
        orden: filaHistorial.creadoEn.getTime(),
        elemento: {
          tipo: "historial" as const,
          id: filaHistorial.id,
          usuarioId: filaHistorial.usuarioId,
          usuarioNombre: filaHistorial.usuarioNombre,
          creadoEn: filaHistorial.creadoEn.toISOString(),
          historialTipo: filaHistorial.historialTipo,
          ...(filaHistorial.datos && typeof filaHistorial.datos === "object"
            ? (filaHistorial.datos as Record<string, unknown>)
            : {}),
        },
      })),
    ];

    elementos.sort((a, b) => b.orden - a.orden);
    const paginaElementos = elementos
      .slice((pagina - 1) * POR_PAGINA, limite)
      .map((fila) => fila.elemento);

    const [totalComentarios] = await db
      .select({ total: count() })
      .from(comentarios)
      .where(eq(comentarios.tareaId, params.data.id));

    const [totalHistorial] = await db
      .select({ total: count() })
      .from(historialTarea)
      .where(eq(historialTarea.tareaId, params.data.id));

    const total = (totalComentarios?.total ?? 0) + (totalHistorial?.total ?? 0);

    return { elementos: paginaElementos, hayMas: total > limite };
  });
}
