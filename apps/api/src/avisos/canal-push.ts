import * as moduloWebPush from "web-push";

import { SinDestinoError, type Canal, type SuscripcionPush } from "./canal.js";

// En Node (ESM) `web-push` es CommonJS y solo expone `default`; en Vite expone exportaciones con nombre.
const webpush = (
  "sendNotification" in moduloWebPush
    ? moduloWebPush
    : (moduloWebPush as unknown as { default: typeof moduloWebPush }).default
) as typeof moduloWebPush;

export interface ConfigPush {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export type EnviarPush = (suscripcion: SuscripcionPush, carga: string) => Promise<void>;
export type BorrarSuscripcion = (endpoint: string) => Promise<void>;

/** Lee la configuración VAPID del entorno; null si falta algo. */
export function leerConfigPush(entorno: NodeJS.ProcessEnv = process.env): ConfigPush | null {
  const publicKey = entorno.VAPID_PUBLIC_KEY;
  const privateKey = entorno.VAPID_PRIVATE_KEY;
  const subject = entorno.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export function crearCanalPush(
  config: ConfigPush | null,
  enviarPush?: EnviarPush,
  borrarSuscripcion?: BorrarSuscripcion,
): Canal | null {
  if (!config) {
    return null;
  }

  let vapidConfigurado = false;

  const enviar: EnviarPush =
    enviarPush ??
    (async (suscripcion, carga) => {
      if (!vapidConfigurado) {
        webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
        vapidConfigurado = true;
      }
      await webpush.sendNotification(
        {
          endpoint: suscripcion.endpoint,
          keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
        },
        carga,
      );
    });

  return {
    id: "push",
    async enviar(destino, aviso) {
      if (destino.suscripcionesPush.length === 0) {
        throw new SinDestinoError("El usuario no tiene suscripciones push");
      }

      const carga = JSON.stringify({
        titulo: aviso.titulo,
        cuerpo: aviso.cuerpo,
        urlRelativa: aviso.urlRelativa,
      });

      let exitos = 0;
      let ultimoError: unknown;

      for (const suscripcion of destino.suscripcionesPush) {
        try {
          await enviar(suscripcion, carga);
          exitos += 1;
        } catch (error) {
          const codigo = (error as { statusCode?: number }).statusCode;
          if ((codigo === 404 || codigo === 410) && borrarSuscripcion) {
            try {
              await borrarSuscripcion(suscripcion.endpoint);
            } catch {
              // La suscripción ya no es válida; el borrado es best-effort.
            }
            continue;
          }
          ultimoError = error;
        }
      }

      if (exitos === 0 && ultimoError !== undefined) {
        throw ultimoError;
      }
    },
  };
}
