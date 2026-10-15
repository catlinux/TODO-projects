import { ErrorHttp, peticion } from "./api";

export type EstadoPush = "no-soportado" | "bloqueado" | "inactivo" | "activo";

/** Comprueba que el navegador tiene lo necesario para avisos push. */
export function soportaPush(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Convierte una clave VAPID en base64url al Uint8Array que espera PushManager. */
export function convertirClaveVapid(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

export async function estadoPush(): Promise<EstadoPush> {
  if (!soportaPush()) {
    return "no-soportado";
  }
  if (Notification.permission === "denied") {
    return "bloqueado";
  }

  const registro = await navigator.serviceWorker.getRegistration();
  if (!registro) {
    return "inactivo";
  }

  const suscripcion = await registro.pushManager.getSubscription();
  return suscripcion ? "activo" : "inactivo";
}

export async function activarPush(): Promise<"activo"> {
  if (!soportaPush()) {
    throw new Error("Tu navegador no admite avisos");
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") {
    throw new Error("Permiso bloqueado en el navegador");
  }

  const registro = await navigator.serviceWorker.register("/sw.js");

  let clave: string;
  try {
    const respuesta = await peticion<{ clave: string }>("/push/clave");
    clave = respuesta.clave;
  } catch (error) {
    if (error instanceof ErrorHttp && error.status === 404) {
      throw new Error("Los avisos del servidor no están configurados");
    }
    throw error;
  }

  const suscripcion = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: convertirClaveVapid(clave),
  });

  await peticion("/push/suscripcion", {
    method: "POST",
    body: JSON.stringify(suscripcion.toJSON()),
  });

  return "activo";
}

export async function desactivarPush(): Promise<void> {
  if (!soportaPush()) {
    return;
  }

  const registro = await navigator.serviceWorker.getRegistration();
  const suscripcion = await registro?.pushManager.getSubscription();
  if (!suscripcion) {
    return;
  }

  await suscripcion.unsubscribe();
  await peticion("/push/suscripcion", {
    method: "DELETE",
    body: JSON.stringify({ endpoint: suscripcion.endpoint }),
  });
}
