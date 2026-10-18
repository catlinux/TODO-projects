import { type FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";

import { columnas, proyectos } from "./db/schema.js";
import type { Database } from "./db/index.js";
import { listarTareasDeProyecto } from "./tareas.js";

const NOMBRE_BANDEJA = "Bandeja de entrada";
const NOMBRE_COLUMNA = "Entrada";

/**
 * Devuelve la bandeja del usuario creándola si aún no existe. El índice único
 * parcial sobre (propietario_id) donde es_bandeja garantiza que, ante dos
 * peticiones a la vez, como mucho una inserte el proyecto.
 */
async function obtenerOCrearBandeja(db: Database, usuarioId: string) {
  const buscar = async () => {
    const [bandeja] = await db
      .select()
      .from(proyectos)
      .where(and(eq(proyectos.propietarioId, usuarioId), eq(proyectos.esBandeja, true)))
      .limit(1);
    return bandeja ?? null;
  };

  const existente = await buscar();
  if (existente) {
    return existente;
  }

  await db.transaction(async (tx) => {
    const [creada] = await tx
      .insert(proyectos)
      .values({ nombre: NOMBRE_BANDEJA, propietarioId: usuarioId, esBandeja: true })
      .onConflictDoNothing()
      .returning();

    if (creada) {
      await tx
        .insert(columnas)
        .values({ proyectoId: creada.id, nombre: NOMBRE_COLUMNA, posicion: 0 });
    }
  });

  return buscar();
}

export function registrarRutasBandeja(app: FastifyInstance, db: Database): void {
  app.get("/bandeja", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const bandeja = await obtenerOCrearBandeja(db, usuario.id);
    if (!bandeja) {
      reply.code(500).send({ mensaje: "No se pudo obtener la bandeja de entrada" });
      return;
    }

    const columnasBandeja = await db
      .select()
      .from(columnas)
      .where(eq(columnas.proyectoId, bandeja.id))
      .orderBy(asc(columnas.posicion));

    const tareas = await listarTareasDeProyecto(db, bandeja.id);

    return { proyecto: bandeja, columnas: columnasBandeja, tareas };
  });
}
