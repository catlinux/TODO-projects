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
  /** Resumen del checklist; lo devuelve `GET /tareas/:id` (fase B). */
  checklist?: { hechos: number; total: number };
  /** Número de comentarios; lo devuelven `GET /tareas/:id` y `GET /proyectos/:id/tareas`. */
  comentarios?: number;
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
  fecha: string;
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
