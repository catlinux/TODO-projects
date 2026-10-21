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

/** Lo mínimo que necesita el cliente para registrar incidencias (p. ej. `request.log`). */
export interface LoggerLlamadaModelo {
  warn: (datos: Record<string, unknown>, mensaje: string) => void;
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
  /** Preset del proveedor, solo para el diagnóstico. */
  preset?: string | null;
  /** Logger del servidor; sin él no se registran incidencias. */
  log?: LoggerLlamadaModelo;
  /** Esperas entre reintentos (por defecto 1 s y 3 s); las pruebas las acortan. */
  esperasReintentoMs?: readonly number[];
}

/** Motivo del corte según el proveedor, normalizado. */
export type FinalizacionModelo = "stop" | "length" | "tool_calls" | "otro";

export interface RespuestaModelo {
  contenido: string | null;
  toolCalls: LlamadaHerramientaModelo[];
  finalizacion: FinalizacionModelo;
  /** Tokens que el modelo gastó en razonar, si el proveedor lo informa. */
  tokensRazonamiento: number;
  /** true si el proveedor devolvió texto de razonamiento (nunca se expone ese texto). */
  tieneRazonamiento: boolean;
}

/** Error del proveedor ya traducido para mostrarlo al usuario, sin datos sensibles. */
export class ErrorProveedor extends Error {
  /** Permite distinguir el agotamiento del tiempo de otros fallos. */
  readonly causa: "tiempo" | "max_tokens" | undefined;
  /** Estado HTTP que devolvió el proveedor, si llegó a responder. */
  readonly estado: number | null;
  /** true si falló la red: no hubo respuesta del proveedor. */
  readonly red: boolean;

  constructor(
    mensaje: string,
    causa?: "tiempo" | "max_tokens",
    detalles: { estado?: number; red?: boolean } = {},
  ) {
    super(mensaje);
    this.name = "ErrorProveedor";
    this.causa = causa;
    this.estado = detalles.estado ?? null;
    this.red = detalles.red ?? false;
  }

  /** Solo los 5xx y los fallos de red son transitorios; un 4xx no se reintenta. */
  get reintentable(): boolean {
    return this.red || (this.estado !== null && this.estado >= 500);
  }
}

interface RespuestaChat {
  choices?: Array<{
    message?: { content?: unknown; tool_calls?: unknown; reasoning_content?: unknown };
    finish_reason?: unknown;
  }>;
  usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } };
}

/** Tope al que se reintenta si el proveedor rechaza el pedido por demasiado alto. */
const MAX_TOKENS_REINTENTO = 4096;
/** Suelo del `max_tokens` cuando un 5xx hace sospechar que el valor alto es la causa. */
const MAX_TOKENS_MINIMO_REINTENTO = 2048;
/** Esperas entre reintentos ante 5xx o fallos de red transitorios. */
const ESPERAS_REINTENTO_MS = [1000, 3000];
/** Caracteres del cuerpo de error del proveedor que se guardan en el log. */
const MAX_CARACTERES_ERROR_LOG = 300;
/** Secretos que nunca deben acabar en el log: claves del proveedor y credenciales Bearer. */
const PATRON_SECRETO = /\boc_sk_[A-Za-z0-9_-]+|\bsk-[A-Za-z0-9_-]+|\bBearer\s+\S+/g;

/** Recorta el cuerpo de error y tapa cualquier cadena con pinta de credencial. */
function cuerpoErrorParaLog(cuerpo: string): string {
  return cuerpo.slice(0, MAX_CARACTERES_ERROR_LOG).replace(PATRON_SECRETO, "***");
}

/** baseUrl sin usuario ni contraseña, por si se guardó con credenciales. */
function sinCredenciales(url: string): string {
  try {
    const limpia = new URL(url);
    limpia.username = "";
    limpia.password = "";
    return limpia.toString();
  } catch {
    return url.replace(/\/\/[^@/]+@/, "//");
  }
}

function registrarErrorProveedor(
  opciones: OpcionesLlamadaModelo,
  maxTokens: number,
  estado: number,
  cuerpoError: string,
  caracteres: number,
): void {
  opciones.log?.warn(
    {
      estado,
      preset: opciones.preset ?? null,
      baseUrl: sinCredenciales(opciones.baseUrl),
      modelo: opciones.modelo,
      maxTokens,
      mensajes: opciones.mensajes.length,
      herramientas: opciones.herramientas?.length ?? 0,
      caracteres,
      cuerpoError: cuerpoErrorParaLog(cuerpoError),
    },
    "El proveedor ha respondido con un error",
  );
}

/** Espera entre reintentos; false si el tiempo total de la petición se agota antes. */
function esperar(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  if (ms <= 0) {
    return Promise.resolve(true);
  }
  return new Promise((resolver) => {
    const alTerminar = (hayTiempo: boolean) => {
      clearTimeout(temporizador);
      signal?.removeEventListener("abort", alAbortar);
      resolver(hayTiempo);
    };
    const alAbortar = () => alTerminar(false);
    const temporizador = setTimeout(() => alTerminar(true), ms);
    signal?.addEventListener("abort", alAbortar, { once: true });
  });
}

function mitadMaxTokens(maxTokens: number): number {
  return Math.min(
    maxTokens,
    Math.max(MAX_TOKENS_MINIMO_REINTENTO, Math.floor(maxTokens / 2)),
  );
}

/** Mensaje final cuando se agotan los reintentos. */
function mensajeTrasReintentos(error: ErrorProveedor): string {
  if (error.red || error.estado === null) {
    return "El proveedor no responde en este momento (sin conexión con el proveedor). Inténtalo de nuevo en unos segundos.";
  }
  return `El proveedor no responde en este momento (error ${error.estado}). Inténtalo de nuevo en unos segundos.`;
}

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
  const esperas = opciones.esperasReintentoMs ?? ESPERAS_REINTENTO_MS;
  const maxTokensReducido = mitadMaxTokens(opciones.maxTokens);
  let maxTokens = opciones.maxTokens;
  let reintentoMaxTokens = false;
  let reintentos = 0;

  for (;;) {
    try {
      return await pedirModelo(opciones, maxTokens);
    } catch (error) {
      if (!(error instanceof ErrorProveedor)) {
        throw error;
      }

      // 400 por un `max_tokens` que el modelo no admite: un único reintento con 4096.
      if (
        error.causa === "max_tokens" &&
        !reintentoMaxTokens &&
        maxTokens > MAX_TOKENS_REINTENTO
      ) {
        reintentoMaxTokens = true;
        maxTokens = MAX_TOKENS_REINTENTO;
        continue;
      }

      if (!error.reintentable) {
        throw error;
      }
      if (reintentos >= esperas.length) {
        throw new ErrorProveedor(mensajeTrasReintentos(error), error.causa, {
          ...(error.estado !== null ? { estado: error.estado } : {}),
          red: error.red,
        });
      }

      const espera = esperas[reintentos] ?? 0;
      reintentos += 1;
      // Sin tiempo total restante no se reintenta: el usuario ya espera demasiado.
      if (!(await esperar(espera, opciones.signal))) {
        throw new ErrorProveedor("El proveedor ha tardado demasiado en responder.", "tiempo");
      }
      maxTokens = maxTokensReducido;
      opciones.log?.warn(
        {
          intento: reintentos,
          esperaMs: espera,
          maxTokens,
          estado: error.estado,
          red: error.red,
        },
        "Se reintenta la llamada al proveedor",
      );
    }
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
  const serializado = JSON.stringify(cuerpo);

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
      body: serializado,
      ...(opciones.signal ? { signal: opciones.signal } : {}),
    });
  } catch (error) {
    if (esCancelacion(error)) {
      throw new ErrorProveedor("El proveedor ha tardado demasiado en responder.", "tiempo");
    }
    throw new ErrorProveedor("No se pudo conectar con el proveedor.", undefined, { red: true });
  }

  if (!respuesta.ok) {
    const cuerpoError = await respuesta.text().catch(() => "");
    registrarErrorProveedor(
      opciones,
      maxTokens,
      respuesta.status,
      cuerpoError,
      serializado.length,
    );
    const detalles = { estado: respuesta.status };
    if (rechazaMaxTokens(respuesta.status, cuerpoError, maxTokens)) {
      throw new ErrorProveedor(
        traducemensajeProveedor(respuesta.status, cuerpoError),
        "max_tokens",
        detalles,
      );
    }
    throw new ErrorProveedor(
      traducemensajeProveedor(respuesta.status, cuerpoError),
      undefined,
      detalles,
    );
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

  const razonamiento = mensaje.reasoning_content;
  const tokensInformados = datos?.usage?.completion_tokens_details?.reasoning_tokens;

  return {
    contenido: typeof mensaje.content === "string" ? mensaje.content : null,
    toolCalls,
    finalizacion: normalizarFinalizacion(eleccion?.finish_reason),
    tokensRazonamiento:
      typeof tokensInformados === "number" && Number.isFinite(tokensInformados)
        ? tokensInformados
        : 0,
    tieneRazonamiento: typeof razonamiento === "string" && razonamiento.trim().length > 0,
  };
}
