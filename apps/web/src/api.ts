export interface UsuarioApi {
  id: string;
  email: string;
  nombre: string;
}

export interface ProyectoApi {
  id: string;
  nombre: string;
  descripcion?: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface OcurrenciaAgenda {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  columnaId: string;
  columnaNombre: string;
  fecha: string;
  esRecurrente: boolean;
  hecha: boolean;
  recordatorioMin: number | null;
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
