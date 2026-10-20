/**
 * `POST /asistente/chat`: bucle de chat con herramientas reutilizando las rutas
 * existentes. Sin estado en el servidor: el cliente envía el historial acotado.
 */

import { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { ZONA_POR_DEFECTO, esquemaChatAsistente } from "@todo/shared";

import type { Database } from "../db/index.js";
import { ErrorProveedor, llamarModelo, type MensajeModelo } from "./cliente.js";
import { obtenerConfigAsistente } from "./config.js";
import {
  HERRAMIENTAS_ASISTENTE,
  ejecutarHerramienta,
  obtenerEstructuraAsistente,
  type AccionAsistente,
  type ContextoAsistente,
  type EstructuraProyecto,
  type ResultadoHerramienta,
} from "./herramientas.js";
import { construirPromptSistema } from "./sistema.js";

export const MAX_VUELTAS_CHAT = 10;
export const TIEMPO_MAXIMO_CHAT_MS = 120_000;
export const MAX_TOKENS_CHAT = 4000;
export const MAX_LONGITUD_RESULTADO = 8000;
export const LIMITE_CHAT_MAX = 20;
export const LIMITE_CHAT_VENTANA_MS = 60_000;
/** Cuerpo máximo de esta ruta: 250 000 caracteres pueden ocupar más del 1 MB por defecto. */
export const LIMITE_CUERPO_CHAT_BYTES = 2 * 1024 * 1024;

export interface OpcionesChat {
  claveCifrado: Buffer | null;
  /** Vueltas máximas del bucle de herramientas. */
  maxVueltas?: number;
  /** Tiempo total máximo de la conversación, en milisegundos. */
  tiempoMaximoMs?: number;
  /** Tope de tokens de cada llamada al modelo. */
  maxTokens?: number;
  /** Límite de peticiones por usuario. */
  limite?: { max: number; ventanaMs: number };
}

function recortar(texto: string, maximo: number = MAX_LONGITUD_RESULTADO): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo)}\n… (resultado recortado)`;
}

async function ejecutarLlamada(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  llamada: { id: string; function: { name: string; arguments: string } },
): Promise<ResultadoHerramienta> {
  let argumentos: unknown = {};
  const bruto = llamada.function.arguments.trim();
  if (bruto.length > 0) {
    try {
      argumentos = JSON.parse(bruto) as unknown;
    } catch {
      return { datos: { error: `Los argumentos de ${llamada.function.name} no son JSON válido.` } };
    }
  }
  return ejecutarHerramienta(app, contexto, llamada.function.name, argumentos);
}

export function registrarRutasChat(
  app: FastifyInstance,
  db: Database,
  opciones: OpcionesChat,
): void {
  const maxVueltas = opciones.maxVueltas ?? MAX_VUELTAS_CHAT;
  const tiempoMaximo = opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_CHAT_MS;
  const maxTokens = opciones.maxTokens ?? MAX_TOKENS_CHAT;
  const limiteMax = opciones.limite?.max ?? LIMITE_CHAT_MAX;
  const limiteVentana = opciones.limite?.ventanaMs ?? LIMITE_CHAT_VENTANA_MS;

  const marcas = new Map<string, number[]>();

  function dentroDelLimite(usuarioId: string): boolean {
    const ahora = Date.now();
    const vigentes = (marcas.get(usuarioId) ?? []).filter((ms) => ahora - ms < limiteVentana);
    if (vigentes.length >= limiteMax) {
      marcas.set(usuarioId, vigentes);
      return false;
    }
    vigentes.push(ahora);
    marcas.set(usuarioId, vigentes);
    return true;
  }

  app.post(
    "/asistente/chat",
    { preHandler: app.requireAuth, bodyLimit: LIMITE_CUERPO_CHAT_BYTES },
    async (request, reply) => {
      const usuario = request.usuario;
      if (!usuario) {
        reply.code(401).send({ mensaje: "No autenticado" });
        return;
      }

      if (!dentroDelLimite(usuario.id)) {
        reply
          .code(429)
          .send({ mensaje: "Demasiadas peticiones al asistente. Inténtalo en un momento." });
        return;
      }

      const cuerpo = esquemaChatAsistente.safeParse(request.body);
      if (!cuerpo.success) {
        reply.code(400).send({
          mensaje: cuerpo.error.issues[0]?.message ?? "Datos de chat no válidos",
        });
        return;
      }

      const config = await obtenerConfigAsistente(db, usuario.id, opciones.claveCifrado);
      if (!config) {
        reply.code(409).send({
          mensaje: "El asistente no está configurado. Configura tu proveedor de IA en Ajustes.",
          configurar: true,
        });
        return;
      }

      // Las herramientas actúan como el propio usuario: se reenvían su sesión y
      // las cabeceras de origen y host de esta petición.
      const contexto: ContextoAsistente = {};
      if (request.headers.cookie) contexto.cookie = request.headers.cookie;
      if (request.headers.authorization) contexto.authorization = request.headers.authorization;
      if (request.headers.origin) contexto.origin = request.headers.origin;
      if (request.headers.host) contexto.host = request.headers.host;

      const zona = cuerpo.data.zona ?? ZONA_POR_DEFECTO;
      const conversacionId = cuerpo.data.conversacionId ?? randomUUID();
      const estructura = await obtenerEstructura(app, contexto);

      const mensajes: MensajeModelo[] = [
        { role: "system", content: construirPromptSistema(estructura, zona) },
      ];
      for (const mensaje of cuerpo.data.mensajes) {
        mensajes.push({ role: mensaje.rol, content: mensaje.texto });
      }

      const signal = AbortSignal.timeout(tiempoMaximo);
      const acciones: AccionAsistente[] = [];
      let ultimoContenido = "";

      try {
        for (let vuelta = 0; vuelta < maxVueltas; vuelta += 1) {
          const respuesta = await llamarModelo({
            baseUrl: config.baseUrl,
            modelo: config.modelo,
            clave: config.clave,
            razonamiento: config.razonamiento,
            mensajes,
            herramientas: HERRAMIENTAS_ASISTENTE,
            maxTokens,
            signal,
            ...(config.preset === "opencode-go" ? { sesion: conversacionId } : {}),
          });

          if (respuesta.toolCalls.length === 0) {
            return { mensaje: respuesta.contenido ?? "", acciones };
          }

          if (respuesta.contenido) {
            ultimoContenido = respuesta.contenido;
          }

          mensajes.push({
            role: "assistant",
            content: respuesta.contenido,
            tool_calls: respuesta.toolCalls,
          });

          for (const llamada of respuesta.toolCalls) {
            const { datos, accion } = await ejecutarLlamada(app, contexto, llamada);
            if (accion) {
              acciones.push(accion);
            }
            mensajes.push({
              role: "tool",
              tool_call_id: llamada.id,
              content: recortar(JSON.stringify(datos)),
            });
          }
        }

        const resumen =
          acciones.length > 0
            ? `He llegado al límite de pasos. Esto es lo que he podido hacer: ${acciones
                .map((accion) => accion.resumen)
                .join("; ")}.`
            : "He llegado al límite de pasos y no he podido completar tu petición.";
        return { mensaje: ultimoContenido ? `${ultimoContenido} ${resumen}` : resumen, acciones };
      } catch (error) {
        if (error instanceof ErrorProveedor) {
          reply.code(502).send({ mensaje: error.message });
          return;
        }
        request.log.error(error);
        reply.code(500).send({ mensaje: "No se pudo completar la conversación con el asistente." });
      }
    },
  );
}

/** La estructura del prompt nunca debe tumbar el chat: si falla, se omite. */
async function obtenerEstructura(
  app: FastifyInstance,
  contexto: ContextoAsistente,
): Promise<EstructuraProyecto[] | null> {
  try {
    return await obtenerEstructuraAsistente(app, contexto);
  } catch {
    return null;
  }
}
