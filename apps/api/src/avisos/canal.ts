export interface UsuarioAviso {
  id: string;
  email: string;
  nombre: string;
}

export interface SuscripcionPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface DestinoAviso {
  usuario: UsuarioAviso;
  suscripcionesPush: SuscripcionPush[];
}

export interface Aviso {
  titulo: string;
  cuerpo: string;
  urlRelativa: string;
}

export type IdCanal = "correo" | "push";

export interface Canal {
  id: IdCanal;
  enviar(destino: DestinoAviso, aviso: Aviso): Promise<void>;
}

/**
 * Señala «sin destino» (no es un fallo). El procesador borra la marca y deja
 * la ocurrencia pendiente por si más adelante hay a dónde enviarla.
 */
export class SinDestinoError extends Error {
  constructor(mensaje = "Sin destino para el aviso") {
    super(mensaje);
    this.name = "SinDestinoError";
  }
}
