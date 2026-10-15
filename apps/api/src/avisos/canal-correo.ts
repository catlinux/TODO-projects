import nodemailer, { type Transporter } from "nodemailer";

import type { Canal } from "./canal.js";

export interface ConfigCorreo {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario?: string;
  contrasena?: string;
  remitente: string;
}

/** Lee la configuración SMTP del entorno; null si falta lo imprescindible. */
export function leerConfigCorreo(entorno: NodeJS.ProcessEnv = process.env): ConfigCorreo | null {
  const host = entorno.SMTP_HOST;
  if (!host) {
    return null;
  }

  const remitente = entorno.SMTP_FROM ?? entorno.SMTP_USER;
  if (!remitente) {
    return null;
  }

  const puertoLeido = Number(entorno.SMTP_PORT ?? "587");
  const config: ConfigCorreo = {
    host,
    puerto: Number.isFinite(puertoLeido) ? puertoLeido : 587,
    seguro: entorno.SMTP_SECURE === "1" || entorno.SMTP_SECURE === "true",
    remitente,
  };

  if (entorno.SMTP_USER) {
    config.usuario = entorno.SMTP_USER;
  }
  if (entorno.SMTP_PASS) {
    config.contrasena = entorno.SMTP_PASS;
  }

  return config;
}

export function crearCanalCorreo(
  config: ConfigCorreo | null,
  transporte?: Transporter,
): Canal | null {
  if (!config) {
    return null;
  }

  const transportador =
    transporte ??
    nodemailer.createTransport(
      config.usuario && config.contrasena
        ? {
            host: config.host,
            port: config.puerto,
            secure: config.seguro,
            auth: { user: config.usuario, pass: config.contrasena },
          }
        : {
            host: config.host,
            port: config.puerto,
            secure: config.seguro,
          },
    );

  return {
    id: "correo",
    async enviar(destino, aviso) {
      await transportador.sendMail({
        from: config.remitente,
        to: destino.usuario.email,
        subject: aviso.titulo,
        text: aviso.cuerpo,
      });
    },
  };
}
