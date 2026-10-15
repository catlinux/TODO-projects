// Verificación de passkeys (WebAuthn) sin dependencias: el cliente envía la clave
// pública en SPKI (getPublicKey()), así no hace falta decodificar CBOR.
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

export const ALGORITMOS = { ES256: -7, RS256: -257, EdDSA: -8 } as const;
const TIPO_CLAVE: Record<number, string> = { [-7]: "ec", [-257]: "rsa", [-8]: "ed25519" };

const BANDERA_UP = 0x01;
const BANDERA_UV = 0x04;
const BANDERA_AT = 0x40;

const DURACION_RETO_MS = 2 * 60 * 1000;
const MAX_RETOS = 1000;

export class ErrorWebAuthn extends Error {}

export interface ConfigWebAuthn {
  origen: string;
  rpId: string;
}

export function configDesdeOrigen(origen: string): ConfigWebAuthn {
  const url = new URL(origen);
  return { origen: url.origin, rpId: url.hostname };
}

export function aBase64url(datos: Uint8Array): string {
  return Buffer.from(datos).toString("base64url");
}

function deBase64url(valor: unknown, campo: string): Buffer {
  if (typeof valor !== "string" || !/^[A-Za-z0-9_-]*$/.test(valor) || valor.length === 0) {
    throw new ErrorWebAuthn(`Campo ${campo} no válido`);
  }
  return Buffer.from(valor, "base64url");
}

interface Reto {
  tipo: "registro" | "entrada";
  usuarioId: string | null;
  expira: number;
}

/** Retos de un solo uso, en memoria y con caducidad. */
export function crearAlmacenRetos(duracionMs = DURACION_RETO_MS, max = MAX_RETOS) {
  const retos = new Map<string, Reto>();

  return {
    crear(tipo: Reto["tipo"], usuarioId: string | null): string {
      const ahora = Date.now();
      for (const [clave, reto] of retos) {
        if (reto.expira <= ahora) retos.delete(clave);
      }
      // El Map conserva el orden de inserción: se descartan los más antiguos.
      while (retos.size >= max) {
        const primero = retos.keys().next().value;
        if (primero === undefined) break;
        retos.delete(primero);
      }
      const reto = aBase64url(randomBytes(32));
      retos.set(reto, { tipo, usuarioId, expira: ahora + duracionMs });
      return reto;
    },
    /** Devuelve el reto y lo borra; null si no existe, caducó o es de otro tipo. */
    consumir(reto: string, tipo: Reto["tipo"]): Reto | null {
      const encontrado = retos.get(reto);
      if (!encontrado) return null;
      retos.delete(reto);
      if (encontrado.expira <= Date.now() || encontrado.tipo !== tipo) return null;
      return encontrado;
    },
  };
}

export type AlmacenRetos = ReturnType<typeof crearAlmacenRetos>;

interface DatosCliente {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function leerDatosCliente(clientDataJSON: Buffer): DatosCliente {
  let datos: unknown;
  try {
    datos = JSON.parse(clientDataJSON.toString("utf8"));
  } catch {
    throw new ErrorWebAuthn("clientDataJSON no válido");
  }
  const d = datos as Partial<DatosCliente>;
  if (
    typeof d.type !== "string" ||
    typeof d.challenge !== "string" ||
    typeof d.origin !== "string"
  ) {
    throw new ErrorWebAuthn("clientDataJSON incompleto");
  }
  return d as DatosCliente;
}

function comprobarCliente(
  datos: DatosCliente,
  tipoEsperado: string,
  config: ConfigWebAuthn,
  retos: AlmacenRetos,
  tipoReto: Reto["tipo"],
): Reto {
  if (datos.type !== tipoEsperado) throw new ErrorWebAuthn("Tipo de operación incorrecto");
  if (datos.origin !== config.origen) throw new ErrorWebAuthn("Origen no permitido");
  if (datos.crossOrigin === true) throw new ErrorWebAuthn("Operación entre orígenes no permitida");
  const reto = retos.consumir(datos.challenge, tipoReto);
  if (!reto) throw new ErrorWebAuthn("Reto no válido o caducado");
  return reto;
}

interface DatosAutenticador {
  banderas: number;
  contador: number;
  credencialId: Buffer | null;
}

function leerDatosAutenticador(datos: Buffer, config: ConfigWebAuthn): DatosAutenticador {
  if (datos.length < 37) throw new ErrorWebAuthn("authenticatorData demasiado corto");
  const rpIdHash = createHash("sha256").update(config.rpId).digest();
  if (!timingSafeEqual(datos.subarray(0, 32), rpIdHash)) {
    throw new ErrorWebAuthn("rpId incorrecto");
  }
  const banderas = datos[32] ?? 0;
  if (!(banderas & BANDERA_UP)) throw new ErrorWebAuthn("Falta la presencia del usuario");
  if (!(banderas & BANDERA_UV)) throw new ErrorWebAuthn("Falta la verificación del usuario");
  const contador = datos.readUInt32BE(33);

  let credencialId: Buffer | null = null;
  if (banderas & BANDERA_AT) {
    // 37: AAGUID (16 bytes), luego longitud del id (2 bytes) y el id.
    if (datos.length < 55) throw new ErrorWebAuthn("Datos de credencial incompletos");
    const largo = datos.readUInt16BE(53);
    if (datos.length < 55 + largo) throw new ErrorWebAuthn("Datos de credencial incompletos");
    credencialId = datos.subarray(55, 55 + largo);
  }
  return { banderas, contador, credencialId };
}

export interface RespuestaRegistro {
  id: unknown;
  clientDataJSON: unknown;
  authenticatorData: unknown;
  publicKey: unknown;
  publicKeyAlgorithm: unknown;
}

export interface CredencialVerificada {
  credencialId: string;
  clavePublica: string;
  algoritmo: number;
  contador: number;
  usuarioId: string;
}

export function verificarRegistro(
  respuesta: RespuestaRegistro,
  config: ConfigWebAuthn,
  retos: AlmacenRetos,
): CredencialVerificada {
  const id = deBase64url(respuesta.id, "id");
  const clientDataJSON = deBase64url(respuesta.clientDataJSON, "clientDataJSON");
  const authenticatorData = deBase64url(respuesta.authenticatorData, "authenticatorData");
  const clavePublica = deBase64url(respuesta.publicKey, "publicKey");
  const algoritmo = respuesta.publicKeyAlgorithm;
  if (typeof algoritmo !== "number" || !TIPO_CLAVE[algoritmo]) {
    throw new ErrorWebAuthn("Algoritmo no admitido");
  }

  const reto = comprobarCliente(
    leerDatosCliente(clientDataJSON),
    "webauthn.create",
    config,
    retos,
    "registro",
  );
  if (!reto.usuarioId) throw new ErrorWebAuthn("Reto sin usuario");

  const datos = leerDatosAutenticador(authenticatorData, config);
  if (!datos.credencialId || !datos.credencialId.equals(id)) {
    throw new ErrorWebAuthn("El id de la credencial no coincide");
  }

  let tipo: string | undefined;
  try {
    tipo = createPublicKey({ key: clavePublica, format: "der", type: "spki" }).asymmetricKeyType;
  } catch {
    throw new ErrorWebAuthn("Clave pública no válida");
  }
  if (tipo !== TIPO_CLAVE[algoritmo]) {
    throw new ErrorWebAuthn("La clave no corresponde al algoritmo");
  }

  return {
    credencialId: aBase64url(id),
    clavePublica: aBase64url(clavePublica),
    algoritmo,
    contador: datos.contador,
    usuarioId: reto.usuarioId,
  };
}

export interface RespuestaEntrada {
  id: unknown;
  clientDataJSON: unknown;
  authenticatorData: unknown;
  signature: unknown;
}

export interface CredencialGuardada {
  clavePublica: string;
  algoritmo: number;
  contador: number;
}

/** Comprueba el reto y el cliente antes de buscar la credencial (consume el reto). */
export function prepararEntrada(
  respuesta: RespuestaEntrada,
  config: ConfigWebAuthn,
  retos: AlmacenRetos,
): { credencialId: string; verificar: (guardada: CredencialGuardada) => number } {
  const id = deBase64url(respuesta.id, "id");
  const clientDataJSON = deBase64url(respuesta.clientDataJSON, "clientDataJSON");
  const authenticatorData = deBase64url(respuesta.authenticatorData, "authenticatorData");
  const firma = deBase64url(respuesta.signature, "signature");

  comprobarCliente(leerDatosCliente(clientDataJSON), "webauthn.get", config, retos, "entrada");
  const datos = leerDatosAutenticador(authenticatorData, config);

  return {
    credencialId: aBase64url(id),
    /** Verifica la firma y el contador; devuelve el contador nuevo. */
    verificar(guardada: CredencialGuardada): number {
      const clave = createPublicKey({
        key: Buffer.from(guardada.clavePublica, "base64url"),
        format: "der",
        type: "spki",
      });
      const firmado = Buffer.concat([
        authenticatorData,
        createHash("sha256").update(clientDataJSON).digest(),
      ]);
      let valida = false;
      try {
        if (guardada.algoritmo === ALGORITMOS.ES256) {
          valida = verify("sha256", firmado, { key: clave, dsaEncoding: "der" }, firma);
        } else if (guardada.algoritmo === ALGORITMOS.RS256) {
          valida = verify("sha256", firmado, clave, firma);
        } else if (guardada.algoritmo === ALGORITMOS.EdDSA) {
          valida = verify(null, firmado, clave, firma);
        }
      } catch {
        valida = false;
      }
      if (!valida) throw new ErrorWebAuthn("Firma no válida");

      // Un contador que no avanza indica una posible credencial clonada.
      if (
        (datos.contador !== 0 || guardada.contador !== 0) &&
        datos.contador <= guardada.contador
      ) {
        throw new ErrorWebAuthn("Contador de la credencial no válido");
      }
      return datos.contador;
    },
  };
}
