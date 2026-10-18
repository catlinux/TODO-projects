import { type FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { columnas, proyectos, tareas } from "./db/schema.js";
import type { Database } from "./db/index.js";

const MIN_LARGO = 2;
const MAX_LARGO = 100;
const MAX_TAREAS = 8;
const MAX_PROYECTOS = 5;

// `ESCAPE '\'` para que %, _ y \ del texto buscado sean literales, no comodines.
const ESCAPE_ILIKE = sql.raw("ESCAPE '\\'");

const esquemaConsulta = z.object({
  q: z
    .string()
    .trim()
    .min(MIN_LARGO, "La búsqueda es demasiado corta")
    .max(MAX_LARGO, "La búsqueda es demasiado larga"),
});

/** Patrón `%texto%` con los comodines de ILIKE escapados. */
export function patronIlike(texto: string): string {
  return `%${texto.replace(/[\\%_]/g, (caracter) => `\\${caracter}`)}%`;
}

export function registrarRutasBuscar(app: FastifyInstance, db: Database): void {
  app.get("/buscar", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const consulta = esquemaConsulta.safeParse(request.query);
    if (!consulta.success) {
      reply.code(400).send({ mensaje: "La búsqueda debe tener entre 2 y 100 caracteres" });
      return;
    }

    const patron = patronIlike(consulta.data.q);
    const coincideTitulo = () => sql`${tareas.titulo} ILIKE ${patron} ${ESCAPE_ILIKE}`;

    const filasTareas = await db
      .select({
        id: tareas.id,
        titulo: tareas.titulo,
        proyectoId: proyectos.id,
        proyectoNombre: proyectos.nombre,
        proyectoColor: proyectos.color,
        columnaId: tareas.columnaId,
        venceEn: tareas.venceEn,
        recurrencia: tareas.recurrencia,
      })
      .from(tareas)
      .innerJoin(proyectos, eq(tareas.proyectoId, proyectos.id))
      .where(
        and(
          eq(proyectos.propietarioId, usuario.id),
          or(
            coincideTitulo(),
            sql`${tareas.descripcion} ILIKE ${patron} ${ESCAPE_ILIKE}`,
          ),
        ),
      )
      // Primero las que coinciden en el título, después las más recientes.
      .orderBy(desc(coincideTitulo()), desc(tareas.updatedAt))
      .limit(MAX_TAREAS);

    // Última columna de cada proyecto (la de mayor posición) para calcular `hecha`.
    const idsProyectos = [...new Set(filasTareas.map((fila) => fila.proyectoId))];
    const ultimaColumna = new Map<string, string>();
    if (idsProyectos.length > 0) {
      const filasColumnas = await db
        .select({ id: columnas.id, proyectoId: columnas.proyectoId })
        .from(columnas)
        .where(inArray(columnas.proyectoId, idsProyectos))
        .orderBy(asc(columnas.posicion));

      for (const columna of filasColumnas) {
        ultimaColumna.set(columna.proyectoId, columna.id);
      }
    }

    const proyectosEncontrados = await db
      .select({ id: proyectos.id, nombre: proyectos.nombre, color: proyectos.color })
      .from(proyectos)
      .where(
        and(
          eq(proyectos.propietarioId, usuario.id),
          eq(proyectos.esBandeja, false),
          sql`${proyectos.nombre} ILIKE ${patron} ${ESCAPE_ILIKE}`,
        ),
      )
      .orderBy(desc(proyectos.updatedAt))
      .limit(MAX_PROYECTOS);

    return {
      tareas: filasTareas.map((fila) => ({
        id: fila.id,
        titulo: fila.titulo,
        proyectoId: fila.proyectoId,
        proyectoNombre: fila.proyectoNombre,
        proyectoColor: fila.proyectoColor,
        columnaId: fila.columnaId,
        venceEn: fila.venceEn ? fila.venceEn.toISOString() : null,
        hecha: fila.recurrencia === null && ultimaColumna.get(fila.proyectoId) === fila.columnaId,
      })),
      proyectos: proyectosEncontrados,
    };
  });
}
