import { describe, expect, it, vi } from "vitest";

const modulos = import.meta.glob("../public/sw.js", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const codigo = Object.values(modulos)[0]!;

interface EventoPush {
  data: { json(): unknown } | null;
  waitUntil(promesa: Promise<unknown>): void;
}

interface EventoClick {
  notification: { close(): void; data?: { url?: string } };
  waitUntil(promesa: Promise<unknown>): void;
}

function cargarServiceWorker() {
  const listeners = new Map<string, (evento: unknown) => void>();
  const showNotification = vi.fn(async () => {});
  const close = vi.fn();
  const focus = vi.fn(async () => {});
  const navigate = vi.fn(async () => {});
  const openWindow = vi.fn(async () => {});

  const selfSimulado = {
    addEventListener: (tipo: string, callback: (evento: unknown) => void) => {
      listeners.set(tipo, callback);
    },
    registration: { showNotification },
    clients: {
      matchAll: vi.fn(async () => [{ focus, navigate, url: "https://app.example.com/" }]),
      openWindow,
    },
  };

  // El service worker usa `self`; se ejecuta con un simulador en el test.
  new Function("self", codigo)(selfSimulado);

  return { listeners, showNotification, close, focus, navigate, openWindow };
}

async function dispararPush(
  listeners: Map<string, (evento: unknown) => void>,
  datos: { json(): unknown } | null,
): Promise<void> {
  let tarea: Promise<unknown> = Promise.resolve();
  const evento: EventoPush = {
    data: datos,
    waitUntil: (promesa) => {
      tarea = promesa;
    },
  };
  (listeners.get("push") as (evento: EventoPush) => void)(evento);
  await tarea;
}

describe("service worker de avisos", () => {
  it("muestra la notificación con los datos del aviso", async () => {
    const { listeners, showNotification } = cargarServiceWorker();

    await dispararPush(listeners, {
      json: () => ({
        titulo: "Recordatorio: Reunión",
        cuerpo: "Vence pronto",
        urlRelativa: "/proyectos/p1",
      }),
    });

    expect(showNotification).toHaveBeenCalledWith("Recordatorio: Reunión", {
      body: "Vence pronto",
      data: { url: "/proyectos/p1" },
    });
  });

  it("no rompe con un payload inválido", async () => {
    const { listeners, showNotification } = cargarServiceWorker();

    await dispararPush(listeners, {
      json: () => {
        throw new Error("json inválido");
      },
    });

    expect(showNotification).toHaveBeenCalledWith("Recordatorio", {
      body: "",
      data: { url: "/" },
    });
  });

  it("al pulsar la notificación enfoca una ventana en la url", async () => {
    const { listeners, close, focus, navigate } = cargarServiceWorker();

    let tarea: Promise<unknown> = Promise.resolve();
    const evento: EventoClick = {
      notification: { close, data: { url: "/proyectos/p1" } },
      waitUntil: (promesa) => {
        tarea = promesa;
      },
    };
    (listeners.get("notificationclick") as (evento: EventoClick) => void)(evento);
    await tarea;

    expect(close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/proyectos/p1");
  });
});
