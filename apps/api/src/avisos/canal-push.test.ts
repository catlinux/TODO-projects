import { describe, expect, it, vi } from "vitest";
import * as webpush from "web-push";

import { crearCanalPush, leerConfigPush, type ConfigPush, type EnviarPush } from "./canal-push.js";
import { SinDestinoError, type Aviso, type DestinoAviso, type SuscripcionPush } from "./canal.js";

const claves = webpush.generateVAPIDKeys();
const config: ConfigPush = {
  publicKey: claves.publicKey,
  privateKey: claves.privateKey,
  subject: "mailto:avisos@example.com",
};

const aviso: Aviso = {
  titulo: "Recordatorio: Reunión",
  cuerpo: "La tarea vence el 10/05/2026 12:00 (proyecto Demo).",
  urlRelativa: "/proyectos/p1",
};

function destino(suscripciones: SuscripcionPush[]): DestinoAviso {
  return {
    usuario: { id: "u1", email: "persona@example.com", nombre: "Persona" },
    suscripcionesPush: suscripciones,
  };
}

describe("leerConfigPush", () => {
  it("devuelve null si faltan claves o subject", () => {
    expect(leerConfigPush({})).toBeNull();
    expect(leerConfigPush({ VAPID_PUBLIC_KEY: "a", VAPID_PRIVATE_KEY: "b" })).toBeNull();
  });

  it("lee la configuración del entorno", () => {
    expect(
      leerConfigPush({
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        VAPID_SUBJECT: "mailto:x@y",
      }),
    ).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:x@y" });
  });
});

describe("crearCanalPush", () => {
  it("devuelve null sin configuración", () => {
    expect(crearCanalPush(null)).toBeNull();
  });

  it("envía a todas las suscripciones", async () => {
    const enviarPush = vi.fn<EnviarPush>(async () => {});
    const canal = crearCanalPush(config, enviarPush);
    const suscripciones: SuscripcionPush[] = [
      { endpoint: "https://push.example.com/1", p256dh: "p1", auth: "a1" },
      { endpoint: "https://push.example.com/2", p256dh: "p2", auth: "a2" },
    ];

    await canal!.enviar(destino(suscripciones), aviso);

    expect(enviarPush).toHaveBeenCalledTimes(2);
    const carga = JSON.parse(String(enviarPush.mock.calls[0]?.[1])) as {
      titulo: string;
      urlRelativa: string;
    };
    expect(carga.titulo).toBe("Recordatorio: Reunión");
    expect(carga.urlRelativa).toBe("/proyectos/p1");
  });

  it("borra la suscripción si el servicio responde 404 o 410", async () => {
    const borrar = vi.fn(async () => {});
    const enviarPush = vi.fn(async (suscripcion: SuscripcionPush) => {
      if (suscripcion.endpoint.endsWith("/1")) {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
    });
    const canal = crearCanalPush(config, enviarPush, borrar);

    await canal!.enviar(
      destino([
        { endpoint: "https://push.example.com/1", p256dh: "p1", auth: "a1" },
        { endpoint: "https://push.example.com/2", p256dh: "p2", auth: "a2" },
      ]),
      aviso,
    );

    expect(borrar).toHaveBeenCalledTimes(1);
    expect(borrar).toHaveBeenCalledWith("https://push.example.com/1");
  });

  it("lanza SinDestinoError si no hay suscripciones", async () => {
    const canal = crearCanalPush(config, async () => {});
    await expect(canal!.enviar(destino([]), aviso)).rejects.toBeInstanceOf(SinDestinoError);
  });
});
