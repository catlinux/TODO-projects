/** Llamada a un modelo por Chat Completions, reutilizable por el chat (paso 2). */

import { VERSION } from "../version.js";

/** OpenCode Go pide identificar a cada cliente con su propio agente de usuario. */
const AGENTE_USUARIO = `TODO-projects-asistente/${VERSION}`;

export interface LlamadaHerramientaModelo {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface MensajeModelo {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: LlamadaHerramientaModelo[];
}

export interface HerramientaModelo {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpcionesLlamadaModelo {
  baseUrl: string;
  modelo: string;
  clave: string;
  razonamiento?: string | null;
  mensajes: MensajeModelo[];
  herramientas?: HerramientaModelo[];
  maxTokens: number;
  signal?: AbortSignal;
  /** Id de sesión estable por conversación; solo se envía con OpenCode Go. */
  sesion?: string;
}

/** Motivo del corte según el proveedor, normalizado. */
export type FinalizacionModelo = "stop" | "length" | "tool_calls" | "otro";

export interface RespuestaModelo {
  contenido: string | null;
  toolCalls: LlamadaHerramientaModelo[];
  finalizacion: FinalizacionModelo;
}

/** Error del proveedor ya traducido para mostrarlo al usuario, sin datos sensibles. */
export class ErrorProveedor extends Error {
  /** Permite distinguir el agotamiento del tiempo de otros fallos. */
  readonly causa: "tiempo" | "max_tokens" | undefined;

  constructor(mensaje: string, causa?: "tiempo" | "max_tokens") {
    super(mensaje);
    this.name = "ErrorProveedor";
    this.causa = causa;
  }
}

interface RespuestaChat {
  choices?: Array<{
    message?: { content?: unknown; tool_calls?: unknown };
    finish_reason?: unknown;
  }>;
}

/** Tope al que se reintenta si el proveedor rechaza el pedido por demasiado alto. */
const MAX_TOKENS_REINTENTO = 4096;

function normalizarFinalizacion(valor: unknown): FinalizacionModelo {
  if (valor === "stop") return "stop";
  if (valor === "length") return "length";
  if (valor === "tool_calls" || valor === "function_call") return "tool_calls";
  return "otro";
}

/** 400 del proveedor por un `max_tokens` mayor de lo que admite el modelo. */
function rechazaMaxTokens(estado: number, cuerpo: string, maxTokens: number): boolean {
  if (estado !== 400 || maxTokens <= MAX_TOKENS_REINTENTO) return false;
  const texto = cuerpo.toLowerCase();
  // El límite de contexto también habla de «maximum» y no se arregla bajando max_tokens.
  if (texto.includes("context length")) return false;
  return (
    texto.includes("max_tokens") ||
    texto.includes("max tokens") ||
    texto.includes("maximum")
  );
}

function traducemensajeProveedor(estado: number, cuerpo: string): string {
  const texto = cuerpo.toLowerCase();
  if (
    estado === 401 ||
    estado === 403 ||
    texto.includes("invalid api key") ||
    texto.includes("incorrect api key")
  ) {
    return "La clave del proveedor no es válida.";
  }
  if (
    estado === 404 ||
    (texto.includes("model") &&
      (texto.includes("not found") ||
        texto.includes("does not exist") ||
        texto.includes("not exist")))
  ) {
    return "El modelo indicado no existe o no está disponible.";
  }
  if (
    texto.includes("maximum context length") ||
    texto.includes("context length") ||
    texto.includes("too many tokens")
  ) {
    return "El texto es demasiado largo para el modelo; adjunta un fragmento más corto.";
  }
  if (estado === 429) {
    return "El proveedor ha rechazado la petición por exceso de solicitudes. Inténtalo más tarde.";
  }
  if (estado >= 500) {
    return "El proveedor no responde en este momento.";
  }
  return `El proveedor ha respondido con un error (HTTP ${estado}).`;
}

function esCancelacion(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const nombre = (error as { name?: unknown }).name;
  return nombre === "AbortError" || nombre === "TimeoutError";
}

function esLlamadaHerramienta(valor: unknown): valor is LlamadaHerramientaModelo {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const llamada = valor as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
  return (
    typeof llamada.id === "string" &&
    typeof llamada.function === "object" &&
    llamada.function !== null &&
    typeof llamada.function.name === "string" &&
    typeof llamada.function.arguments === "string"
  );
}

export async function llamarModelo(opciones: OpcionesLlamadaModelo): Promise<RespuestaModelo> {
  try {
    return await pedirModelo(opciones, opciones.maxTokens);
  } catch (error) {
    if (
      error instanceof ErrorProveedor &&
      error.causa === "max_tokens" &&
      opciones.maxTokens > MAX_TOKENS_REINTENTO
    ) {
      return pedirModelo(opciones, MAX_TOKENS_REINTENTO);
    }
    throw error;
  }
}

async function pedirModelo(
  opciones: OpcionesLlamadaModelo,
  maxTokens: number,
): Promise<RespuestaModelo> {
  const url = `${opciones.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const cuerpo: Record<string, unknown> = {
    model: opciones.modelo,
    messages: opciones.mensajes,
    max_tokens: maxTokens,
  };
  if (opciones.herramientas && opciones.herramientas.length > 0) {
    cuerpo.tools = opciones.herramientas;
  }
  if (opciones.razonamiento) {
    cuerpo.reasoning_effort = opciones.razonamiento;
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opciones.clave}`,
        "user-agent": AGENTE_USUARIO,
        ...(opciones.sesion ? { "x-opencode-session": opciones.sesion } : {}),
      },
      body: JSON.stringify(cuerpo),
      ...(opciones.signal ? { signal: opciones.signal } : {}),
    });
  } catch (error) {
    if (esCancelacion(error)) {
      throw new ErrorProveedor("El proveedor ha tardado demasiado en responder.", "tiempo");
    }
    throw new ErrorProveedor("No se pudo conectar con el proveedor.");
  }

  if (!respuesta.ok) {
    const cuerpoError = await respuesta.text().catch(() => "");
    if (rechazaMaxTokens(respuesta.status, cuerpoError, maxTokens)) {
      throw new ErrorProveedor(traducemensajeProveedor(respuesta.status, cuerpoError), "max_tokens");
    }
    throw new ErrorProveedor(traducemensajeProveedor(respuesta.status, cuerpoError));
  }

  const datos = (await respuesta.json().catch(() => null)) as RespuestaChat | null;
  const eleccion = datos?.choices?.[0];
  const mensaje = eleccion?.message;
  if (!mensaje) {
    throw new ErrorProveedor("El proveedor ha devuelto una respuesta no válida.");
  }

  const toolCalls = Array.isArray(mensaje.tool_calls)
    ? mensaje.tool_calls.filter(esLlamadaHerramienta)
    : [];

  return {
    contenido: typeof mensaje.content === "string" ? mensaje.content : null,
    toolCalls,
    finalizacion: normalizarFinalizacion(eleccion?.finish_reason),
  };
}
