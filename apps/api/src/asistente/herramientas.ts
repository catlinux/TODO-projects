/**
 * Herramientas del asistente. Todas reutilizan las rutas HTTP existentes con
 * `app.inject`, reenviando la sesión (cookie, authorization) y las cabeceras de
 * origen y host de la petición original: así heredan validación, propiedad,
 * historial y expansión de recurrencias sin tocar la base de datos.
 */

import { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { HerramientaModelo } from "./cliente.js";

export const MAX_PROYECTOS_ESTRUCTURA = 100;

/** Cabeceras de la petición original que se reenvían a las rutas internas. */
export interface ContextoAsistente {
  cookie?: string;
  authorization?: string;
  origin?: string;
  host?: string;
}

/** Escritura realizada por el asistente, para devolverla al cliente. */
export interface AccionAsistente {
  herramienta: string;
  resumen: string;
  enlace?: string;
}

export interface ResultadoHerramienta {
  datos: unknown;
  accion?: AccionAsistente;
}

export interface EstructuraProyecto {
  id: string;
  nombre: string;
  descripcion: string | null;
  columnas: Array<{ id: string; nombre: string }>;
  etiquetas: Array<{ id: string; nombre: string }>;
  /** Proyecto especial del usuario donde van las tareas sin proyecto. */
  esBandeja?: boolean;
}

interface RespuestaRuta {
  ok: boolean;
  estado: number;
  datos: unknown;
  mensaje: string | null;
}

function registro(valor: unknown): Record<string, unknown> {
  return typeof valor === "object" && valor !== null ? (valor as Record<string, unknown>) : {};
}

function texto(valor: unknown, defecto = ""): string {
  return typeof valor === "string" ? valor : defecto;
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function cabecerasReenvio(contexto: ContextoAsistente): Record<string, string> {
  const cabeceras: Record<string, string> = {};
  if (contexto.cookie) cabeceras.cookie = contexto.cookie;
  if (contexto.authorization) cabeceras.authorization = contexto.authorization;
  if (contexto.origin) cabeceras.origin = contexto.origin;
  if (contexto.host) cabeceras.host = contexto.host;
  return cabeceras;
}

function extraerMensaje(datos: unknown): string | null {
  const mensaje = registro(datos).mensaje;
  return typeof mensaje === "string" && mensaje.length > 0 ? mensaje : null;
}

async function llamarRuta(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  metodo: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: unknown,
): Promise<RespuestaRuta> {
  const respuesta = await app.inject({
    method: metodo,
    url,
    headers: cabecerasReenvio(contexto),
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });

  let datos: unknown = null;
  if (respuesta.body.length > 0) {
    try {
      datos = JSON.parse(respuesta.body) as unknown;
    } catch {
      datos = respuesta.body;
    }
  }

  const ok = respuesta.statusCode >= 200 && respuesta.statusCode < 300;
  return {
    ok,
    estado: respuesta.statusCode,
    datos,
    mensaje: ok
      ? null
      : (extraerMensaje(datos) ?? `La ruta ha respondido con HTTP ${respuesta.statusCode}`),
  };
}

function errorDeRuta(respuesta: RespuestaRuta): ResultadoHerramienta {
  return { datos: { error: respuesta.mensaje ?? "La operación no se pudo completar" } };
}

async function obtenerColumnas(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  proyectoId: string,
): Promise<Array<{ id: string; nombre: string }>> {
  const respuesta = await llamarRuta(app, contexto, "GET", `/proyectos/${proyectoId}/columnas`);
  if (!respuesta.ok) {
    return [];
  }
  return lista(respuesta.datos).map((columna) => {
    const fila = registro(columna);
    return { id: texto(fila.id), nombre: texto(fila.nombre) };
  });
}

/**
 * Bandeja de entrada del usuario. GET /proyectos no la incluye, así que se lee
 * de su propia ruta; si falla, el asistente sigue sin ella.
 */
export async function obtenerBandejaAsistente(
  app: FastifyInstance,
  contexto: ContextoAsistente,
): Promise<EstructuraProyecto | null> {
  try {
    const respuesta = await llamarRuta(app, contexto, "GET", "/bandeja");
    if (!respuesta.ok) {
      return null;
    }

    const datos = registro(respuesta.datos);
    const proyecto = registro(datos.proyecto);
    const id = texto(proyecto.id);
    if (!id) {
      return null;
    }

    return {
      id,
      nombre: texto(proyecto.nombre, "Bandeja de entrada"),
      descripcion: typeof proyecto.descripcion === "string" ? proyecto.descripcion : null,
      columnas: lista(datos.columnas).map((columna) => {
        const fila = registro(columna);
        return { id: texto(fila.id), nombre: texto(fila.nombre) };
      }),
      etiquetas: [],
      esBandeja: true,
    };
  } catch {
    return null;
  }
}

/** Proyectos del usuario con sus columnas y etiquetas, leídos por las rutas. */
export async function obtenerEstructuraAsistente(
  app: FastifyInstance,
  contexto: ContextoAsistente,
): Promise<EstructuraProyecto[] | null> {
  const [respuesta, bandeja] = await Promise.all([
    llamarRuta(app, contexto, "GET", "/proyectos"),
    obtenerBandejaAsistente(app, contexto),
  ]);
  if (!respuesta.ok || !Array.isArray(respuesta.datos)) {
    return null;
  }

  const proyectos = respuesta.datos.slice(0, MAX_PROYECTOS_ESTRUCTURA);
  const estructura = await Promise.all(
    proyectos.map(async (proyecto) => {
      const fila = registro(proyecto);
      const id = texto(fila.id);
      const [columnas, etiquetas] = await Promise.all([
        obtenerColumnas(app, contexto, id),
        llamarRuta(app, contexto, "GET", `/proyectos/${id}/etiquetas`),
      ]);
      return {
        id,
        nombre: texto(fila.nombre),
        descripcion: typeof fila.descripcion === "string" ? fila.descripcion : null,
        columnas,
        etiquetas: etiquetas.ok
          ? lista(etiquetas.datos).map((etiqueta) => {
              const datosEtiqueta = registro(etiqueta);
              return { id: texto(datosEtiqueta.id), nombre: texto(datosEtiqueta.nombre) };
            })
          : [],
      };
    }),
  );

  if (bandeja && !estructura.some((proyecto) => proyecto.id === bandeja.id)) {
    estructura.push(bandeja);
  }
  return estructura;
}

const idUuid = { type: "string", format: "uuid", description: "Identificador UUID del recurso" };
const fechaIso = {
  type: "string",
  format: "date-time",
  description:
    "Fecha y hora en ISO 8601 con desfase horario, por ejemplo 2026-10-19T18:00:00+02:00",
};

/** Definiciones JSON schema de las herramientas, en castellano y sin borrados. */
export const HERRAMIENTAS_ASISTENTE: HerramientaModelo[] = [
  {
    type: "function",
    function: {
      name: "listar_proyectos",
      description:
        "Lista los proyectos del usuario con sus columnas y etiquetas (ids y nombres). Úsala para conocer la estructura antes de crear o mover cosas.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_tareas",
      description: "Lista las tareas de un proyecto, con su columna, fechas y etiquetas.",
      parameters: {
        type: "object",
        properties: { proyectoId: idUuid },
        required: ["proyectoId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_agenda",
      description: "Consulta las ocurrencias de la agenda entre dos fechas.",
      parameters: {
        type: "object",
        properties: { desde: fechaIso, hasta: fechaIso },
        required: ["desde", "hasta"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_proyecto",
      description: "Crea un proyecto nuevo.",
      parameters: {
        type: "object",
        properties: {
          nombre: { type: "string", description: "Nombre del proyecto" },
          descripcion: { type: "string", description: "Descripción opcional del proyecto" },
        },
        required: ["nombre"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_tarea",
      description:
        "Crea una tarea en un proyecto. Si se omite proyectoId se crea en la Bandeja de entrada. Si no se indica columna se usa la primera. Acepta etiquetas existentes del proyecto y un checklist inicial.",
      parameters: {
        type: "object",
        properties: {
          proyectoId: {
            ...idUuid,
            description:
              "Proyecto destino (opcional). Omítelo para crear la tarea en la Bandeja de entrada",
          },
          titulo: { type: "string", description: "Título de la tarea" },
          descripcion: { type: "string", description: "Descripción opcional" },
          columnaId: { type: "string", format: "uuid", description: "Columna destino (opcional)" },
          venceEn: { ...fechaIso, description: `${fechaIso.description} (fecha de vencimiento)` },
          recurrencia: {
            type: "string",
            description: "Regla RRULE sin prefijo, por ejemplo FREQ=WEEKLY;BYDAY=MO",
          },
          recordatorioMin: {
            type: "integer",
            minimum: 0,
            maximum: 10080,
            description: "Minutos antes del vencimiento para el recordatorio",
          },
          etiquetaIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            description: "Ids de etiquetas existentes del proyecto",
          },
          checklist: {
            type: "array",
            items: { type: "string", description: "Texto de un elemento del checklist" },
            description: "Elementos iniciales del checklist",
          },
        },
        required: ["titulo"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "actualizar_tarea",
      description: "Cambia campos de una tarea existente. Solo se envían los campos indicados.",
      parameters: {
        type: "object",
        properties: {
          tareaId: idUuid,
          campos: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              descripcion: { type: "string" },
              columnaId: { type: "string", format: "uuid" },
              posicion: { type: "integer", minimum: 0 },
              venceEn: { type: ["string", "null"], description: "ISO 8601 con desfase, o null" },
              recurrencia: {
                type: ["string", "null"],
                description: "Regla RRULE sin prefijo, o null para quitarla",
              },
              recordatorioMin: { type: ["integer", "null"], minimum: 0, maximum: 10080 },
            },
            additionalProperties: false,
          },
        },
        required: ["tareaId", "campos"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mover_tarea",
      description: "Mueve una tarea a otra columna, opcionalmente en una posición concreta.",
      parameters: {
        type: "object",
        properties: {
          tareaId: idUuid,
          columnaId: { type: "string", format: "uuid", description: "Columna destino" },
          posicion: { type: "integer", minimum: 0, description: "Posición dentro de la columna" },
        },
        required: ["tareaId", "columnaId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "completar_tarea",
      description:
        "Marca como hecha o pendiente una tarea. En tareas recurrentes actúa sobre una ocurrencia concreta (fechaOriginal); en las demás mueve la tarea a la última columna (hecha) o a la primera (pendiente).",
      parameters: {
        type: "object",
        properties: {
          tareaId: idUuid,
          hecha: { type: "boolean", description: "true para completar, false para reabrir" },
          fechaOriginal: {
            ...fechaIso,
            description: `${fechaIso.description} (clave de la ocurrencia; obligatoria si la tarea es recurrente)`,
          },
        },
        required: ["tareaId", "hecha"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "anadir_checklist",
      description: "Añade elementos al checklist de una tarea.",
      parameters: {
        type: "object",
        properties: {
          tareaId: idUuid,
          textos: {
            type: "array",
            minItems: 1,
            items: {
              anyOf: [
                { type: "string", description: "Texto del elemento" },
                {
                  type: "object",
                  properties: {
                    texto: { type: "string", description: "Texto del elemento" },
                    descripcion: {
                      type: "string",
                      description: "Descripción larga opcional del elemento",
                    },
                  },
                  required: ["texto"],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
        required: ["tareaId", "textos"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "excepcion_ocurrencia",
      description:
        "Mueve u omite una sola ocurrencia de una tarea recurrente, indicando su fecha original.",
      parameters: {
        type: "object",
        properties: {
          tareaId: idUuid,
          fechaOriginal: fechaIso,
          fechaNueva: {
            ...fechaIso,
            description: `${fechaIso.description} (nueva fecha; indica esto o omitida)`,
          },
          omitida: { type: "boolean", description: "true para omitir esa ocurrencia" },
        },
        required: ["tareaId", "fechaOriginal"],
        additionalProperties: false,
      },
    },
  },
];

type Validacion<T> = { ok: true; datos: T } | { ok: false; error: string };

function validar<T>(esquema: z.ZodType<T>, valor: unknown): Validacion<T> {
  const resultado = esquema.safeParse(valor ?? {});
  if (!resultado.success) {
    const problema = resultado.error.issues[0];
    const ruta = problema && problema.path.length > 0 ? ` (${problema.path.join(".")})` : "";
    return {
      ok: false,
      error: `Argumentos no válidos${ruta}: ${problema?.message ?? "revisa los datos"}`,
    };
  }
  return { ok: true, datos: resultado.data };
}

const esquemaCrearProyecto = z.object({
  nombre: z.string().trim().min(1).max(200),
  descripcion: z.string().max(5000).optional(),
});

const esquemaCrearTarea = z.object({
  proyectoId: z.string().uuid().optional(),
  titulo: z.string().trim().min(1).max(300),
  descripcion: z.string().max(5000).optional(),
  columnaId: z.string().uuid().optional(),
  venceEn: z.string().datetime({ offset: true }).optional(),
  recurrencia: z.string().trim().min(1).optional(),
  recordatorioMin: z.number().int().min(0).max(10080).optional(),
  etiquetaIds: z.array(z.string().uuid()).optional(),
  checklist: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
});

const esquemaCamposTarea = z.object({
  titulo: z.string().trim().min(1).max(300).optional(),
  descripcion: z.string().max(5000).optional(),
  columnaId: z.string().uuid().optional(),
  posicion: z.number().int().min(0).optional(),
  venceEn: z.string().datetime({ offset: true }).nullable().optional(),
  recurrencia: z.string().trim().min(1).nullable().optional(),
  recordatorioMin: z.number().int().min(0).max(10080).nullable().optional(),
});

const esquemaActualizarTarea = z.object({
  tareaId: z.string().uuid(),
  campos: esquemaCamposTarea,
});

const esquemaMoverTarea = z.object({
  tareaId: z.string().uuid(),
  columnaId: z.string().uuid(),
  posicion: z.number().int().min(0).optional(),
});

const esquemaCompletarTarea = z.object({
  tareaId: z.string().uuid(),
  hecha: z.boolean(),
  fechaOriginal: z.string().datetime({ offset: true }).optional(),
});

const esquemaAnadirChecklist = z.object({
  tareaId: z.string().uuid(),
  textos: z
    .array(
      z.union([
        z.string().trim().min(1).max(500),
        z.object({
          texto: z.string().trim().min(1).max(500),
          descripcion: z.string().trim().max(5000).optional(),
        }),
      ]),
    )
    .min(1),
});

const esquemaExcepcion = z.object({
  tareaId: z.string().uuid(),
  fechaOriginal: z.string().datetime({ offset: true }),
  fechaNueva: z.string().datetime({ offset: true }).optional(),
  omitida: z.boolean().optional(),
});

async function leerTarea(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  tareaId: string,
): Promise<{ tarea: Record<string, unknown> } | { error: ResultadoHerramienta }> {
  const respuesta = await llamarRuta(app, contexto, "GET", `/tareas/${tareaId}`);
  if (!respuesta.ok) {
    return { error: errorDeRuta(respuesta) };
  }
  return { tarea: registro(respuesta.datos) };
}

function conAccion(datos: unknown, accion: AccionAsistente): ResultadoHerramienta {
  return { datos, accion };
}

async function ejecutarListarProyectos(
  app: FastifyInstance,
  contexto: ContextoAsistente,
): Promise<ResultadoHerramienta> {
  const estructura = await obtenerEstructuraAsistente(app, contexto);
  if (estructura === null) {
    return { datos: { error: "No se pudieron leer los proyectos." } };
  }
  return { datos: { proyectos: estructura } };
}

async function ejecutarListarTareas(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(z.object({ proyectoId: z.string().uuid() }), valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }

  const proyectoId = validado.datos.proyectoId;
  const respuesta = await llamarRuta(app, contexto, "GET", `/proyectos/${proyectoId}/tareas`);
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  const columnas = await obtenerColumnas(app, contexto, proyectoId);
  const ultimaColumnaId = columnas.length > 0 ? columnas[columnas.length - 1]!.id : null;

  const tareas = lista(respuesta.datos).map((tarea) => {
    const fila = registro(tarea);
    return {
      id: texto(fila.id),
      titulo: texto(fila.titulo),
      descripcion: typeof fila.descripcion === "string" ? fila.descripcion : null,
      columnaId: texto(fila.columnaId),
      venceEn: fila.venceEn ?? null,
      recurrencia: fila.recurrencia ?? null,
      recordatorioMin: fila.recordatorioMin ?? null,
      etiquetas: Array.isArray(fila.etiquetas) ? fila.etiquetas : [],
      checklist: fila.checklist ?? null,
      hecha: ultimaColumnaId !== null && texto(fila.columnaId) === ultimaColumnaId,
    };
  });

  return { datos: { proyectoId, columnas, tareas } };
}

async function ejecutarConsultarAgenda(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(
    z.object({
      desde: z.string().datetime({ offset: true }),
      hasta: z.string().datetime({ offset: true }),
    }),
    valor,
  );
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }

  const parametros = new URLSearchParams({
    desde: validado.datos.desde,
    hasta: validado.datos.hasta,
  });
  const respuesta = await llamarRuta(app, contexto, "GET", `/agenda?${parametros.toString()}`);
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  const ocurrencias = lista(respuesta.datos).map((ocurrencia) => {
    const fila = registro(ocurrencia);
    return {
      tareaId: texto(fila.tareaId),
      titulo: texto(fila.titulo),
      proyectoId: texto(fila.proyectoId),
      proyecto: texto(fila.proyectoNombre),
      columna: texto(fila.columnaNombre),
      fecha: fila.fecha ?? null,
      fechaOriginal: fila.fechaOriginal ?? null,
      recurrente: fila.esRecurrente === true,
      hecha: fila.hecha === true,
    };
  });

  return { datos: { desde: validado.datos.desde, hasta: validado.datos.hasta, ocurrencias } };
}

async function ejecutarCrearProyecto(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaCrearProyecto, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }

  const respuesta = await llamarRuta(app, contexto, "POST", "/proyectos", validado.datos);
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  const proyecto = registro(respuesta.datos);
  const id = texto(proyecto.id);
  return conAccion(
    { proyecto },
    {
      herramienta: "crear_proyecto",
      resumen: `Proyecto «${texto(proyecto.nombre, validado.datos.nombre)}» creado`,
      enlace: `/proyectos/${id}`,
    },
  );
}

async function ejecutarCrearTarea(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaCrearTarea, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }
  const datos = validado.datos;

  // Sin proyecto explícito, la tarea va a la Bandeja de entrada.
  let proyectoId = datos.proyectoId;
  let enBandeja = false;
  if (!proyectoId) {
    const bandeja = await obtenerBandejaAsistente(app, contexto);
    if (!bandeja) {
      return {
        datos: {
          error:
            "No se pudo obtener la Bandeja de entrada. Indica en qué proyecto crear la tarea.",
        },
      };
    }
    proyectoId = bandeja.id;
    enBandeja = true;
  }

  const respuesta = await llamarRuta(app, contexto, "POST", `/proyectos/${proyectoId}/tareas`, {
    titulo: datos.titulo,
    ...(datos.descripcion !== undefined ? { descripcion: datos.descripcion } : {}),
    ...(datos.columnaId !== undefined ? { columnaId: datos.columnaId } : {}),
    ...(datos.venceEn !== undefined ? { venceEn: datos.venceEn } : {}),
    ...(datos.recurrencia !== undefined ? { recurrencia: datos.recurrencia } : {}),
    ...(datos.recordatorioMin !== undefined ? { recordatorioMin: datos.recordatorioMin } : {}),
  });
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  const tarea = registro(respuesta.datos);
  const tareaId = texto(tarea.id);
  const avisos: string[] = [];

  if (datos.etiquetaIds && datos.etiquetaIds.length > 0) {
    const etiquetas = await llamarRuta(app, contexto, "PUT", `/tareas/${tareaId}/etiquetas`, {
      ids: datos.etiquetaIds,
    });
    if (!etiquetas.ok) {
      avisos.push(`No se pudieron asignar las etiquetas: ${etiquetas.mensaje}`);
    }
  }

  let creadosChecklist = 0;
  for (const textoElemento of datos.checklist ?? []) {
    const elemento = await llamarRuta(app, contexto, "POST", `/tareas/${tareaId}/checklist`, {
      texto: textoElemento,
    });
    if (elemento.ok) {
      creadosChecklist += 1;
    } else {
      avisos.push(`No se pudo añadir «${textoElemento}» al checklist: ${elemento.mensaje}`);
    }
  }

  return conAccion(
    {
      tarea,
      ...(enBandeja ? { bandeja: true } : {}),
      ...(creadosChecklist > 0 ? { checklistCreado: creadosChecklist } : {}),
      ...(avisos.length > 0 ? { avisos } : {}),
    },
    {
      herramienta: "crear_tarea",
      resumen: enBandeja
        ? `Tarea «${texto(tarea.titulo, datos.titulo)}» creada en la Bandeja de entrada`
        : `Tarea «${texto(tarea.titulo, datos.titulo)}» creada`,
      enlace: `/proyectos/${proyectoId}/tareas/${tareaId}`,
    },
  );
}

async function ejecutarActualizarTarea(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaActualizarTarea, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }
  const { tareaId, campos } = validado.datos;

  if (Object.keys(campos).length === 0) {
    return { datos: { error: "No hay ningún campo que actualizar." } };
  }

  const actual = await leerTarea(app, contexto, tareaId);
  if ("error" in actual) {
    return actual.error;
  }
  const proyectoId = texto(actual.tarea.proyectoId);

  const respuesta = await llamarRuta(app, contexto, "PATCH", `/tareas/${tareaId}`, campos);
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  const tarea = registro(respuesta.datos);
  return conAccion(
    { tarea },
    {
      herramienta: "actualizar_tarea",
      resumen: `Tarea «${texto(actual.tarea.titulo)}» actualizada`,
      ...(proyectoId ? { enlace: `/proyectos/${proyectoId}/tareas/${tareaId}` } : {}),
    },
  );
}

async function ejecutarMoverTarea(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaMoverTarea, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }
  const { tareaId, columnaId, posicion } = validado.datos;

  const actual = await leerTarea(app, contexto, tareaId);
  if ("error" in actual) {
    return actual.error;
  }
  const proyectoId = texto(actual.tarea.proyectoId);

  const respuesta = await llamarRuta(app, contexto, "PATCH", `/tareas/${tareaId}`, {
    columnaId,
    ...(posicion !== undefined ? { posicion } : {}),
  });
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  const columnas = await obtenerColumnas(app, contexto, proyectoId);
  const destino = columnas.find((columna) => columna.id === columnaId);

  return conAccion(
    { tarea: registro(respuesta.datos) },
    {
      herramienta: "mover_tarea",
      resumen: destino
        ? `Tarea «${texto(actual.tarea.titulo)}» movida a «${destino.nombre}»`
        : `Tarea «${texto(actual.tarea.titulo)}» movida de columna`,
      ...(proyectoId ? { enlace: `/proyectos/${proyectoId}/tareas/${tareaId}` } : {}),
    },
  );
}

async function ejecutarCompletarTarea(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaCompletarTarea, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }
  const { tareaId, hecha, fechaOriginal } = validado.datos;

  const actual = await leerTarea(app, contexto, tareaId);
  if ("error" in actual) {
    return actual.error;
  }
  const tarea = actual.tarea;
  const proyectoId = texto(tarea.proyectoId);
  const titulo = texto(tarea.titulo);
  const enlace = proyectoId ? { enlace: `/proyectos/${proyectoId}/tareas/${tareaId}` } : {};

  // Las series recurrentes se completan ocurrencia a ocurrencia.
  if (typeof tarea.recurrencia === "string" && tarea.recurrencia.length > 0) {
    if (!fechaOriginal) {
      return {
        datos: {
          error:
            "La tarea es recurrente: indica la fecha de la ocurrencia que quieres marcar (fechaOriginal).",
        },
      };
    }
    const respuesta = await llamarRuta(app, contexto, "POST", `/tareas/${tareaId}/ocurrencias`, {
      fecha: fechaOriginal,
      hecha,
    });
    if (!respuesta.ok) {
      return errorDeRuta(respuesta);
    }
    return conAccion(
      { tareaId, fechaOriginal, hecha },
      {
        herramienta: "completar_tarea",
        resumen: hecha
          ? `Ocurrencia del ${fechaOriginal} marcada como hecha`
          : `Ocurrencia del ${fechaOriginal} marcada como pendiente`,
        ...enlace,
      },
    );
  }

  const columnas = await obtenerColumnas(app, contexto, proyectoId);
  if (columnas.length === 0) {
    return { datos: { error: "El proyecto no tiene columnas." } };
  }
  const destino = hecha ? columnas[columnas.length - 1]! : columnas[0]!;

  const respuesta = await llamarRuta(app, contexto, "PATCH", `/tareas/${tareaId}`, {
    columnaId: destino.id,
  });
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  return conAccion(
    { tarea: registro(respuesta.datos) },
    {
      herramienta: "completar_tarea",
      resumen: hecha ? `Tarea «${titulo}» completada` : `Tarea «${titulo}» reabierta`,
      ...enlace,
    },
  );
}

async function ejecutarAnadirChecklist(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaAnadirChecklist, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }
  const { tareaId, textos } = validado.datos;

  const actual = await leerTarea(app, contexto, tareaId);
  if ("error" in actual) {
    return actual.error;
  }
  const proyectoId = texto(actual.tarea.proyectoId);

  const avisos: string[] = [];
  let creados = 0;
  for (const elemento of textos) {
    const datos =
      typeof elemento === "string"
        ? { texto: elemento }
        : {
            texto: elemento.texto,
            ...(elemento.descripcion ? { descripcion: elemento.descripcion } : {}),
          };
    const respuesta = await llamarRuta(app, contexto, "POST", `/tareas/${tareaId}/checklist`, datos);
    if (respuesta.ok) {
      creados += 1;
    } else {
      const nombre = typeof elemento === "string" ? elemento : elemento.texto;
      avisos.push(`No se pudo añadir «${nombre}»: ${respuesta.mensaje}`);
    }
  }

  if (creados === 0) {
    return { datos: { error: avisos[0] ?? "No se pudo añadir ningún elemento." } };
  }

  return conAccion(
    { creados, ...(avisos.length > 0 ? { avisos } : {}) },
    {
      herramienta: "anadir_checklist",
      resumen: `Añadidos ${creados} elementos al checklist de «${texto(actual.tarea.titulo)}»`,
      ...(proyectoId ? { enlace: `/proyectos/${proyectoId}/tareas/${tareaId}` } : {}),
    },
  );
}

async function ejecutarExcepcionOcurrencia(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  valor: unknown,
): Promise<ResultadoHerramienta> {
  const validado = validar(esquemaExcepcion, valor);
  if (!validado.ok) {
    return { datos: { error: validado.error } };
  }
  const { tareaId, fechaOriginal, fechaNueva, omitida } = validado.datos;

  if (omitida !== true && fechaNueva === undefined) {
    return {
      datos: { error: "Indica fechaNueva para mover la ocurrencia u omitida para omitirla." },
    };
  }

  const actual = await leerTarea(app, contexto, tareaId);
  if ("error" in actual) {
    return actual.error;
  }
  const proyectoId = texto(actual.tarea.proyectoId);

  const respuesta = await llamarRuta(app, contexto, "PUT", `/tareas/${tareaId}/excepciones`, {
    fechaOriginal,
    ...(fechaNueva !== undefined ? { fechaNueva } : {}),
    ...(omitida !== undefined ? { omitida } : {}),
  });
  if (!respuesta.ok) {
    return errorDeRuta(respuesta);
  }

  return conAccion(
    { excepcion: respuesta.datos },
    {
      herramienta: "excepcion_ocurrencia",
      resumen:
        omitida === true
          ? `Ocurrencia del ${fechaOriginal} omitida`
          : `Ocurrencia del ${fechaOriginal} movida al ${fechaNueva}`,
      ...(proyectoId ? { enlace: `/proyectos/${proyectoId}/tareas/${tareaId}` } : {}),
    },
  );
}

/** Ejecuta una herramienta por su nombre; nunca lanza: los fallos vuelven al modelo. */
export async function ejecutarHerramienta(
  app: FastifyInstance,
  contexto: ContextoAsistente,
  nombre: string,
  argumentos: unknown,
): Promise<ResultadoHerramienta> {
  switch (nombre) {
    case "listar_proyectos":
      return ejecutarListarProyectos(app, contexto);
    case "listar_tareas":
      return ejecutarListarTareas(app, contexto, argumentos);
    case "consultar_agenda":
      return ejecutarConsultarAgenda(app, contexto, argumentos);
    case "crear_proyecto":
      return ejecutarCrearProyecto(app, contexto, argumentos);
    case "crear_tarea":
      return ejecutarCrearTarea(app, contexto, argumentos);
    case "actualizar_tarea":
      return ejecutarActualizarTarea(app, contexto, argumentos);
    case "mover_tarea":
      return ejecutarMoverTarea(app, contexto, argumentos);
    case "completar_tarea":
      return ejecutarCompletarTarea(app, contexto, argumentos);
    case "anadir_checklist":
      return ejecutarAnadirChecklist(app, contexto, argumentos);
    case "excepcion_ocurrencia":
      return ejecutarExcepcionOcurrencia(app, contexto, argumentos);
    default:
      return { datos: { error: `Herramienta desconocida: ${nombre}` } };
  }
}
