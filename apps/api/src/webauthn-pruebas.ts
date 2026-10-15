// Ayudantes de pruebas: simulan un autenticador WebAuthn con claves de node:crypto.
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

import { ALGORITMOS } from "./webauthn.js";

export const ORIGEN = "https://todo.ejemplo.com";
export const RP_ID = "todo.ejemplo.com";

const UP_UV = 0x05;

export interface Autenticador {
  algoritmo: number;
  credencialId: Buffer;
  privada: KeyObject;
  spki: Buffer;
  contador: number;
}

export function crearAutenticador(algoritmo: number = ALGORITMOS.ES256): Autenticador {
  const par =
    algoritmo === ALGORITMOS.ES256
      ? generateKeyPairSync("ec", { namedCurve: "P-256" })
      : algoritmo === ALGORITMOS.RS256
        ? generateKeyPairSync("rsa", { modulusLength: 2048 })
        : generateKeyPairSync("ed25519");
  return {
    algoritmo,
    credencialId: randomBytes(16),
    privada: par.privateKey,
    spki: par.publicKey.export({ format: "der", type: "spki" }),
    contador: 0,
  };
}

export function datosAutenticador(opciones: {
  rpId?: string | undefined;
  banderas?: number | undefined;
  contador?: number | undefined;
  credencialId?: Buffer | undefined;
}): Buffer {
  const rpIdHash = createHash("sha256")
    .update(opciones.rpId ?? RP_ID)
    .digest();
  const conCredencial = opciones.credencialId !== undefined;
  const banderas = Buffer.from([(opciones.banderas ?? UP_UV) | (conCredencial ? 0x40 : 0)]);
  const contador = Buffer.alloc(4);
  contador.writeUInt32BE(opciones.contador ?? 0);
  if (!opciones.credencialId) return Buffer.concat([rpIdHash, banderas, contador]);

  const largo = Buffer.alloc(2);
  largo.writeUInt16BE(opciones.credencialId.length);
  // AAGUID a ceros y un mapa CBOR vacío donde iría la clave COSE (no se lee).
  return Buffer.concat([
    rpIdHash,
    banderas,
    contador,
    Buffer.alloc(16),
    largo,
    opciones.credencialId,
    Buffer.from([0xa0]),
  ]);
}

export function datosCliente(type: string, challenge: string, origin = ORIGEN): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

const b64 = (datos: Buffer) => datos.toString("base64url");

export function respuestaRegistro(
  aut: Autenticador,
  challenge: string,
  cambios: { origin?: string; rpId?: string; banderas?: number; type?: string } = {},
) {
  return {
    id: b64(aut.credencialId),
    clientDataJSON: b64(datosCliente(cambios.type ?? "webauthn.create", challenge, cambios.origin)),
    authenticatorData: b64(
      datosAutenticador({
        rpId: cambios.rpId,
        banderas: cambios.banderas,
        contador: aut.contador,
        credencialId: aut.credencialId,
      }),
    ),
    publicKey: b64(aut.spki),
    publicKeyAlgorithm: aut.algoritmo,
  };
}

export function respuestaEntrada(
  aut: Autenticador,
  challenge: string,
  cambios: { origin?: string; rpId?: string; banderas?: number; contador?: number } = {},
) {
  const authenticatorData = datosAutenticador({
    rpId: cambios.rpId,
    banderas: cambios.banderas,
    contador: cambios.contador ?? aut.contador,
  });
  const clientDataJSON = datosCliente("webauthn.get", challenge, cambios.origin);
  const firmado = Buffer.concat([
    authenticatorData,
    createHash("sha256").update(clientDataJSON).digest(),
  ]);
  const firma =
    aut.algoritmo === ALGORITMOS.EdDSA
      ? sign(null, firmado, aut.privada)
      : sign("sha256", firmado, aut.privada);
  return {
    id: b64(aut.credencialId),
    clientDataJSON: b64(clientDataJSON),
    authenticatorData: b64(authenticatorData),
    signature: b64(firma),
  };
}
