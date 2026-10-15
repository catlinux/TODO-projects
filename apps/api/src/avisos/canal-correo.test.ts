import { describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";

import { leerConfigCorreo, crearCanalCorreo, type ConfigCorreo } from "./canal-correo.js";
import type { Aviso, DestinoAviso } from "./canal.js";

const config: ConfigCorreo = {
  host: "smtp.example.com",
  puerto: 587,
  seguro: false,
  usuario: "avisos@example.com",
  contrasena: "secreto-de-prueba",
  remitente: "avisos@example.com",
};

const destino: DestinoAviso = {
  usuario: { id: "u1", email: "persona@example.com", nombre: "Persona" },
  suscripcionesPush: [],
};

const aviso: Aviso = {
  titulo: "Recordatorio: Reunión",
  cuerpo: "La tarea vence el 10/05/2026 12:00 (proyecto Demo).",
  urlRelativa: "/proyectos/p1",
};

describe("leerConfigCorreo", () => {
  it("devuelve null si falta el host o el remitente", () => {
    expect(leerConfigCorreo({})).toBeNull();
    expect(leerConfigCorreo({ SMTP_HOST: "smtp.example.com" })).toBeNull();
  });

  it("lee la configuración del entorno", () => {
    const leida = leerConfigCorreo({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "1",
      SMTP_USER: "avisos@example.com",
      SMTP_PASS: "secreto",
      SMTP_FROM: "Avisos <avisos@example.com>",
    });
    expect(leida).toEqual({
      host: "smtp.example.com",
      puerto: 465,
      seguro: true,
      usuario: "avisos@example.com",
      contrasena: "secreto",
      remitente: "Avisos <avisos@example.com>",
    });
  });

  it("usa el usuario como remitente si no hay SMTP_FROM", () => {
    const leida = leerConfigCorreo({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "avisos@example.com",
    });
    expect(leida?.remitente).toBe("avisos@example.com");
  });
});

describe("crearCanalCorreo", () => {
  it("devuelve null sin configuración", () => {
    expect(crearCanalCorreo(null)).toBeNull();
  });

  it("envía con el transporte inyectado", async () => {
    const transporte = nodemailer.createTransport({ jsonTransport: true });
    const espia = vi.spyOn(transporte, "sendMail");

    const canal = crearCanalCorreo(config, transporte);
    expect(canal).not.toBeNull();

    await canal!.enviar(destino, aviso);

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0]?.[0]).toMatchObject({
      from: config.remitente,
      to: destino.usuario.email,
      subject: "Recordatorio: Reunión",
      text: aviso.cuerpo,
    });
  });
});
