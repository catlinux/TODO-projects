import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  PRESETS_ASISTENTE_DEFECTOS,
  esBaseUrlAsistentePermitida,
  esquemaConfigAsistente,
  esquemaPruebaAsistente,
  type PresetAsistente,
} from "@todo/shared";

import { asistenteConfig } from "../db/schema.js";
import type { Database } from "../db/index.js";
import { cifrarClave, descifrarClave } from "./cifrado.js";
import { ErrorProveedor, llamarModelo } from "./cliente.js";

export const TIEMPO_MAXIMO_PRUEBA_MS = 20_000;

const MAX_TOKENS_PRUEBA = 16;
const MENSAJE_PRUEBA = "Responde solo con OK.";
const MENSAJE_SIN_CLAVE_CIFRADO =
  "El asistente no está disponible: falta la variable ASISTENTE_CLAVE_CIFRADO en el servidor.";

export interface OpcionesAsistente {
  /** Clave AES del entorno; null si falta y el asistente queda desactivado. */
  claveCifrado: Buffer | null;
  tiempoMaximoPruebaMs?: number;
}

/** Configuración lista para llamar al proveedor, con la clave ya descifrada. */
export interface ConfigAsistente {
  preset: string;
  baseUrl: string;
  modelo: string;
  razonamiento: string | null;
  clave: string;
}

interface RespuestaConfig {
  disponible: boolean;
  configurado: boolean;
  preset: string | null;
  baseUrl: string | null;
  modelo: string | null;
  razonamiento: string | null;
  claveTermina: string | null;
}

type FilaAsistente = typeof asistenteConfig.$inferSelect;

async function leerFila(db: Database, usuarioId: string): Promise<FilaAsistente | null> {
  const [fila] = await db
    .select()
    .from(asistenteConfig)
    .where(eq(asistenteConfig.usuarioId, usuarioId))
    .limit(1);
  return fila ?? null;
}

/** Configuración descifrada de un usuario, o null si no hay o no se puede leer. */
export async function obtenerConfigAsistente(
  db: Database,
  usuarioId: string,
  claveCifrado: Buffer | null,
): Promise<ConfigAsistente | null> {
  if (!claveCifrado) {
    return null;
  }
  const fila = await leerFila(db, usuarioId);
  if (!fila) {
    return null;
  }
  const clave = descifrarClave(fila.claveCifrada, claveCifrado);
  if (clave === null) {
    return null;
  }
  return {
    preset: fila.preset,
    baseUrl: fila.baseUrl,
    modelo: fila.modelo,
    razonamiento: fila.razonamiento,
    clave,
  };
}

const SIN_DISPONIBILIDAD: RespuestaConfig = {
  disponible: false,
  configurado: false,
  preset: null,
  baseUrl: null,
  modelo: null,
  razonamiento: null,
  claveTermina: null,
};

function terminaEn(clave: string): string | null {
  return clave.length >= 4 ? `…${clave.slice(-4)}` : null;
}

function respuestaConfig(fila: FilaAsistente | null, claveCifrado: Buffer | null): RespuestaConfig {
  if (!claveCifrado) {
    // Sin clave de cifrado el asistente queda como no configurado, aunque haya fila.
    return SIN_DISPONIBILIDAD;
  }
  if (!fila) {
    return { ...SIN_DISPONIBILIDAD, disponible: true };
  }
  const clave = descifrarClave(fila.claveCifrada, claveCifrado);
  return {
    disponible: true,
    configurado: true,
    preset: fila.preset,
    baseUrl: fila.baseUrl,
    modelo: fila.modelo,
    razonamiento: fila.razonamiento,
    claveTermina: clave === null ? null : terminaEn(clave),
  };
}

/** Resuelve base URL, modelo y razonamiento a partir del cuerpo, el preset y lo guardado. */
function resolverValores(
  datos: {
    preset?: PresetAsistente | undefined;
    baseUrl?: string | undefined;
    modelo?: string | undefined;
    razonamiento?: string | null | undefined;
  },
  existente: FilaAsistente | null,
): { baseUrl: string | null; modelo: string | null; razonamiento: string | null } {
  const defectos = datos.preset ? PRESETS_ASISTENTE_DEFECTOS[datos.preset] : null;
  const baseUrl = datos.baseUrl ?? defectos?.baseUrl ?? existente?.baseUrl ?? null;
  const modelo = datos.modelo ?? defectos?.modelo ?? existente?.modelo ?? null;
  const razonamiento =
    datos.razonamiento !== undefined
      ? datos.razonamiento
      : defectos
        ? defectos.razonamiento
        : (existente?.razonamiento ?? null);
  return { baseUrl, modelo, razonamiento };
}

function faltaObligatorio(baseUrl: string | null, modelo: string | null): string | null {
  if (!baseUrl || !esBaseUrlAsistentePermitida(baseUrl)) {
    return "Indica una URL base válida (https://) para el proveedor";
  }
  if (!modelo) {
    return "Indica el modelo del proveedor";
  }
  return null;
}

export function registrarRutasAsistente(
  app: FastifyInstance,
  db: Database,
  opciones: OpcionesAsistente,
): void {
  const tiempoMaximoPrueba = opciones.tiempoMaximoPruebaMs ?? TIEMPO_MAXIMO_PRUEBA_MS;

  app.get("/asistente/config", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }
    const fila = await leerFila(db, usuario.id);
    return respuestaConfig(fila, opciones.claveCifrado);
  });

  app.put("/asistente/config", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }
    if (!opciones.claveCifrado) {
      reply.code(503).send({ mensaje: MENSAJE_SIN_CLAVE_CIFRADO });
      return;
    }

    const cuerpo = esquemaConfigAsistente.safeParse(request.body);
    if (!cuerpo.success) {
      reply.code(400).send({
        mensaje: cuerpo.error.issues[0]?.message ?? "Datos de configuración no válidos",
      });
      return;
    }
    const datos = cuerpo.data;

    const existente = await leerFila(db, usuario.id);
    const { baseUrl, modelo, razonamiento } = resolverValores(datos, existente);
    const problema = faltaObligatorio(baseUrl, modelo);
    if (problema || !baseUrl || !modelo) {
      reply.code(400).send({ mensaje: problema ?? "Datos de configuración no válidos" });
      return;
    }

    let claveCifrada: string;
    if (datos.clave !== undefined) {
      claveCifrada = cifrarClave(datos.clave, opciones.claveCifrado);
    } else if (existente) {
      claveCifrada = existente.claveCifrada;
    } else {
      reply.code(400).send({ mensaje: "Indica la clave del proveedor" });
      return;
    }

    await db
      .insert(asistenteConfig)
      .values({
        usuarioId: usuario.id,
        preset: datos.preset,
        baseUrl,
        modelo,
        razonamiento,
        claveCifrada,
      })
      .onConflictDoUpdate({
        target: asistenteConfig.usuarioId,
        set: { preset: datos.preset, baseUrl, modelo, razonamiento, claveCifrada },
      });

    const fila = await leerFila(db, usuario.id);
    return respuestaConfig(fila, opciones.claveCifrado);
  });

  app.delete("/asistente/config", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }
    await db.delete(asistenteConfig).where(eq(asistenteConfig.usuarioId, usuario.id));
    reply.code(204).send();
  });

  app.post("/asistente/probar", { preHandler: app.requireAuth }, async (request, reply) => {
    const usuario = request.usuario;
    if (!usuario) {
      reply.code(401).send({ mensaje: "No autenticado" });
      return;
    }

    const cuerpo = esquemaPruebaAsistente.safeParse(request.body ?? {});
    if (!cuerpo.success) {
      reply.code(400).send({
        mensaje: cuerpo.error.issues[0]?.message ?? "Datos de prueba no válidos",
      });
      return;
    }
    const datos = cuerpo.data;

    const existente = await leerFila(db, usuario.id);
    const { baseUrl, modelo, razonamiento } = resolverValores(datos, existente);
    const problema = faltaObligatorio(baseUrl, modelo);
    if (problema || !baseUrl || !modelo) {
      reply.code(400).send({ mensaje: problema ?? "Datos de prueba no válidos" });
      return;
    }

    let clave: string | null = datos.clave ?? null;
    if (clave === null && existente) {
      if (!opciones.claveCifrado) {
        reply.code(503).send({ mensaje: MENSAJE_SIN_CLAVE_CIFRADO });
        return;
      }
      clave = descifrarClave(existente.claveCifrada, opciones.claveCifrado);
      if (clave === null) {
        reply.code(400).send({ mensaje: "No se pudo leer la clave guardada; vuelve a guardarla" });
        return;
      }
    }
    if (clave === null) {
      reply.code(400).send({ mensaje: "Configura el proveedor antes de probarlo" });
      return;
    }

    try {
      await llamarModelo({
        baseUrl,
        modelo,
        clave,
        razonamiento,
        mensajes: [{ role: "user", content: MENSAJE_PRUEBA }],
        maxTokens: MAX_TOKENS_PRUEBA,
        signal: AbortSignal.timeout(tiempoMaximoPrueba),
        preset: datos.preset ?? existente?.preset ?? null,
        log: request.log,
        ...((datos.preset ?? existente?.preset) === "opencode-go"
          ? { sesion: randomUUID() }
          : {}),
      });
      return { ok: true };
    } catch (error) {
      const mensaje =
        error instanceof ErrorProveedor ? error.message : "No se pudo comprobar el proveedor.";
      return { ok: false, mensaje };
    }
  });
}
