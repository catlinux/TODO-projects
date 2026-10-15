// Passkeys (WebAuthn) con el autenticador del dispositivo: huella, cara o Windows Hello.
import { peticion } from "./api";

export const MARCA_HUELLA = "todo.huella";
export const MARCA_AHORA_NO = "todo.huellaAhoraNo";

export function aBase64url(datos: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    datos instanceof ArrayBuffer
      ? new Uint8Array(datos)
      : new Uint8Array(datos.buffer, datos.byteOffset, datos.byteLength);
  let binario = "";
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deBase64url(valor: string): ArrayBuffer {
  const base64 = valor.replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes.buffer;
}

export function leerMarca(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

export function guardarMarca(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Sin almacenamiento (modo privado): solo se pierde el recordatorio.
  }
}

export async function soportaHuella(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === "undefined") return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function nombreDispositivo(): string {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iPhone";
  if (/windows/i.test(ua)) return "Windows";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/linux/i.test(ua)) return "Linux";
  return "Dispositivo";
}

interface DescriptorApi {
  type: "public-key";
  id: string;
}

interface OpcionesRegistroApi {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  authenticatorSelection: AuthenticatorSelectionCriteria;
  attestation: AttestationConveyancePreference;
  timeout: number;
  excludeCredentials: DescriptorApi[];
}

interface OpcionesEntradaApi {
  challenge: string;
  rpId: string;
  allowCredentials: DescriptorApi[];
  userVerification: UserVerificationRequirement;
  timeout: number;
}

const aDescriptor = (d: DescriptorApi): PublicKeyCredentialDescriptor => ({
  type: d.type,
  id: deBase64url(d.id),
});

export async function registrarHuella(nombre = nombreDispositivo()): Promise<void> {
  const opciones = await peticion<OpcionesRegistroApi>("/auth/huella/registro-opciones", {
    method: "POST",
  });
  const credencial = (await navigator.credentials.create({
    publicKey: {
      ...opciones,
      challenge: deBase64url(opciones.challenge),
      user: { ...opciones.user, id: deBase64url(opciones.user.id) },
      excludeCredentials: opciones.excludeCredentials.map(aDescriptor),
    },
  })) as PublicKeyCredential | null;
  if (!credencial) throw new Error("No se pudo activar la huella");

  const respuesta = credencial.response as AuthenticatorAttestationResponse;
  // getPublicKey() evita decodificar CBOR en el servidor; los navegadores antiguos no lo tienen.
  const clavePublica =
    typeof respuesta.getPublicKey === "function" ? respuesta.getPublicKey() : null;
  if (!clavePublica || typeof respuesta.getAuthenticatorData !== "function") {
    throw new Error("Este navegador no permite activar la huella");
  }

  await peticion("/auth/huella/registro", {
    method: "POST",
    body: JSON.stringify({
      id: credencial.id,
      clientDataJSON: aBase64url(respuesta.clientDataJSON),
      authenticatorData: aBase64url(respuesta.getAuthenticatorData()),
      publicKey: aBase64url(clavePublica),
      publicKeyAlgorithm: respuesta.getPublicKeyAlgorithm(),
      nombre,
    }),
  });
  guardarMarca(MARCA_HUELLA, "1");
}

export async function entrarConHuella(): Promise<void> {
  const opciones = await peticion<OpcionesEntradaApi>("/auth/huella/entrada-opciones", {
    method: "POST",
  });
  const credencial = (await navigator.credentials.get({
    publicKey: {
      ...opciones,
      challenge: deBase64url(opciones.challenge),
      allowCredentials: opciones.allowCredentials.map(aDescriptor),
    },
  })) as PublicKeyCredential | null;
  if (!credencial) throw new Error("No se pudo leer la huella");

  const respuesta = credencial.response as AuthenticatorAssertionResponse;
  await peticion("/auth/huella/entrada", {
    method: "POST",
    body: JSON.stringify({
      id: credencial.id,
      clientDataJSON: aBase64url(respuesta.clientDataJSON),
      authenticatorData: aBase64url(respuesta.authenticatorData),
      signature: aBase64url(respuesta.signature),
    }),
  });
  guardarMarca(MARCA_HUELLA, "1");
}
