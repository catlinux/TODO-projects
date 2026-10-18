export interface UsuarioApi {
  id: string;
  email: string;
  nombre: string;
}

export type AmbienteFondoApi = "bosque" | "noche" | "coral" | "pizarra" | "ciruela";

export type FondoProyectoApi =
  | { tipo: "ambiente"; ambiente: AmbienteFondoApi }
  | { tipo: "color"; color: string }
  | { tipo: "imagenes"; ids: string[]; intervaloSeg: number };

export interface ProyectoApi {
  id: string;
  nombre: string;
  descripcion?: string | null;
  color?: string | null;
  fondo?: FondoProyectoApi | null;
  propietarioId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnaApi {
  id: string;
  proyectoId: string;
  nombre: string;
  posicion: number;
  createdAt: string;
  updatedAt: string;
}

export type PortadaTareaApi =
  | { tipo: "color"; valor: string }
  | { tipo: "imagen"; archivoId: string };

/** Adjunto de una tarea o fondo de un proyecto (fase E). */
export interface ArchivoApi {
  id: string;
  nombre: string;
  mime: string;
  tamano: number;
  createdAt: string;
}

/** Mime de imagen que la API sirve en línea; el resto va como octet-stream. */
export function esImagenPermitida(mime: string): boolean {
  return /^image\/(png|jpeg|webp|gif)$/.test(mime);
}

/** Elemento del checklist tal como lo pinta la tarjeta del tablero. */
export interface ElementoChecklistTarjetaApi {
  id: string;
  texto: string;
  hecho: boolean;
}

export interface TareaApi {
  id: string;
  proyectoId: string;
  columnaId: string;
  titulo: string;
  descripcion?: string | null;
  posicion: number;
  venceEn?: string | null;
  recurrencia?: string | null;
  zona?: string | null;
  recordatorioMin?: number | null;
  portada?: PortadaTareaApi | null;
  etiquetas?: string[];
  /** Resumen del checklist; `GET /proyectos/:id/tareas` incluye además los elementos. */
  checklist?: { hechos: number; total: number; items?: ElementoChecklistTarjetaApi[] };
  /** Número de comentarios; lo devuelven `GET /tareas/:id` y `GET /proyectos/:id/tareas`. */
  comentarios?: number;
  /** Número de adjuntos; lo devuelven `GET /tareas/:id` y `GET /proyectos/:id/tareas`. */
  adjuntos?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EtiquetaApi {
  id: string;
  proyectoId: string;
  nombre: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItemApi {
  id: string;
  tareaId: string;
  texto: string;
  hecho: boolean;
  posicion: number;
  createdAt: string;
}

export interface ElementoComentarioApi {
  tipo: "comentario";
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
  texto: string;
}

/** Entrada de historial: los datos propios del tipo van al mismo nivel. */
export interface ElementoHistorialApi {
  tipo: "historial";
  id: string;
  usuarioId: string;
  usuarioNombre: string;
  creadoEn: string;
  historialTipo: string;
  desde?: string | null;
  hasta?: string | null;
  accion?: string;
  nombre?: string;
  texto?: string;
  antes?: unknown;
  despues?: unknown;
}

export type ElementoActividadApi = ElementoComentarioApi | ElementoHistorialApi;

export interface RespuestaActividadApi {
  elementos: ElementoActividadApi[];
  hayMas: boolean;
}

export interface RespuestaBandejaApi {
  proyecto: ProyectoApi;
  columnas: ColumnaApi[];
  tareas: TareaApi[];
}

export interface OcurrenciaAgenda {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  columnaId: string;
  columnaNombre: string;
  /** Columna de menor `posicion` del proyecto (destino al desmarcar). */
  primeraColumnaId: string;
  /** Columna de mayor `posicion` del proyecto: estar en ella es estar «hecha». */
  ultimaColumnaId: string;
  /** Fecha efectiva de la ocurrencia (la nueva si se movió con una excepción). */
  fecha: string;
  /** Fecha original de la serie; clave de la ocurrencia y de `ocurrencias_hechas`. */
  fechaOriginal: string;
  /** La ocurrencia tiene una excepción (movida, omitida o con otro título). */
  conExcepcion: boolean;
  esRecurrente: boolean;
  hecha: boolean;
  recordatorioMin: number | null;
}

export interface TareaBusquedaApi {
  id: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  proyectoColor: string | null;
  columnaId: string;
  venceEn: string | null;
  hecha: boolean;
}

export interface ProyectoBusquedaApi {
  id: string;
  nombre: string;
  color: string | null;
}

export interface ResultadoBusquedaApi {
  tareas: TareaBusquedaApi[];
  proyectos: ProyectoBusquedaApi[];
}

export type PermisoTokenApi = "lectura" | "escritura" | "calendario";

export interface TokenApi {
  id: string;
  nombre: string;
  permiso: PermisoTokenApi;
  prefijo: string;
  ultimoUso?: string | null;
  expiraEn?: string | null;
  revocadoEn?: string | null;
  createdAt: string;
}

export interface TokenCreadoApi {
  id: string;
  nombre: string;
  permiso: PermisoTokenApi;
  prefijo: string;
  expiraEn?: string | null;
  token: string;
}

export interface ActividadApi {
  id: string;
  accion: "crear" | "editar" | "borrar";
  entidad: string;
  entidadId: string;
  tokenNombre: string | null;
  antes: unknown;
  despues: unknown;
  deshechoEn: string | null;
  createdAt: string;
  titulo: string | null;
}

export type PresetAsistenteApi = "deepseek" | "openai" | "personalizado";

export type RazonamientoAsistenteApi = "none" | "low" | "medium" | "high";

/** Estado del proveedor del asistente; la clave nunca se devuelve entera. */
export interface ConfigAsistenteApi {
  disponible: boolean;
  configurado: boolean;
  preset: PresetAsistenteApi | null;
  baseUrl: string | null;
  modelo: string | null;
  razonamiento: RazonamientoAsistenteApi | null;
  claveTermina: string | null;
}

/** Escritura realizada por una herramienta del asistente. */
export interface AccionAsistenteApi {
  herramienta: string;
  resumen: string;
  enlace?: string;
}

export interface RespuestaChatAsistenteApi {
  mensaje: string;
  acciones: AccionAsistenteApi[];
}

export class ErrorHttp extends Error {
  status: number;
  codigo: string | undefined;

  constructor(status: number, mensaje: string, codigo?: string) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

async function leerError(respuesta: Response): Promise<{ mensaje?: string; codigo?: string }> {
  try {
    const cuerpo: unknown = await respuesta.json();
    if (typeof cuerpo === "object" && cuerpo !== null) {
      const datos = cuerpo as { mensaje?: unknown; codigo?: unknown };
      return {
        ...(typeof datos.mensaje === "string" ? { mensaje: datos.mensaje } : {}),
        ...(typeof datos.codigo === "string" ? { codigo: datos.codigo } : {}),
      };
    }
  } catch {
    // Respuesta sin JSON útil.
  }
  return {};
}

export async function peticion<T>(ruta: string, init?: RequestInit): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
    credentials: "same-origin",
    ...init,
    // Fastify rechaza con 400 un Content-Type JSON sin cuerpo (DELETE, logout).
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  return interpretar<T>(respuesta);
}

/**
 * Sube un fichero por multipart reutilizando la base y las credenciales. No se
 * fija Content-Type: el navegador añade el boundary de FormData.
 */
export async function subirArchivo<T>(
  ruta: string,
  campo: string,
  fichero: File,
): Promise<T> {
  const datos = new FormData();
  datos.append(campo, fichero);

  const respuesta = await fetch(`/api${ruta}`, {
    method: "POST",
    credentials: "same-origin",
    body: datos,
  });

  return interpretar<T>(respuesta);
}

async function interpretar<T>(respuesta: Response): Promise<T> {
  if (respuesta.status === 401) {
    const { mensaje = "No autenticado", codigo } = await leerError(respuesta);
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ErrorHttp(401, mensaje, codigo);
  }

  if (!respuesta.ok) {
    const { mensaje = "Error", codigo } = await leerError(respuesta);
    throw new ErrorHttp(respuesta.status, mensaje, codigo);
  }

  if (respuesta.status === 204) {
    return undefined as T;
  }

  return (await respuesta.json()) as T;
}
