import { afterEach, describe, expect, it, vi } from "vitest";

import { activarPush, convertirClaveVapid, desactivarPush, estadoPush, soportaPush } from "./push";

function instalarNavegador(opciones: {
  permission?: NotificationPermission;
  serviceWorker?: Record<string, unknown>;
}): void {
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", {
    permission: opciones.permission ?? "default",
    requestPermission: vi.fn(async () => opciones.permission ?? "default"),
  });
  vi.stubGlobal("navigator", { serviceWorker: opciones.serviceWorker ?? {} });
}

const suscripcion = {
  endpoint: "https://push.example.com/abc",
  toJSON: () => ({
    endpoint: "https://push.example.com/abc",
    keys: { p256dh: "p256dh", auth: "auth" },
  }),
  unsubscribe: vi.fn(async () => true),
};

describe("convertirClaveVapid", () => {
  it("convierte base64url a bytes", () => {
    expect([...convertirClaveVapid("aG9sYQ")]).toEqual([104, 111, 108, 97]);
  });
});

describe("soportaPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detecta un navegador compatible", () => {
    instalarNavegador({ serviceWorker: {} });
    expect(soportaPush()).toBe(true);
  });

  it("detecta un navegador sin soporte", () => {
    vi.stubGlobal("navigator", {});
    expect(soportaPush()).toBe(false);
  });
});

describe("estadoPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-soportado sin las APIs", async () => {
    vi.stubGlobal("navigator", {});
    expect(await estadoPush()).toBe("no-soportado");
  });

  it("bloqueado si el permiso está denegado", async () => {
    instalarNavegador({
      permission: "denied",
      serviceWorker: { getRegistration: async () => null },
    });
    expect(await estadoPush()).toBe("bloqueado");
  });

  it("inactivo sin registro o sin suscripción", async () => {
    instalarNavegador({
      permission: "default",
      serviceWorker: { getRegistration: async () => null },
    });
    expect(await estadoPush()).toBe("inactivo");

    instalarNavegador({
      permission: "default",
      serviceWorker: {
        getRegistration: async () => ({ pushManager: { getSubscription: async () => null } }),
      },
    });
    expect(await estadoPush()).toBe("inactivo");
  });

  it("activo si hay suscripción", async () => {
    instalarNavegador({
      permission: "granted",
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => suscripcion },
        }),
      },
    });
    expect(await estadoPush()).toBe("activo");
  });
});

describe("activarPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("pide permiso, registra el service worker y guarda la suscripción", async () => {
    const registrar = vi.fn(async () => ({
      pushManager: { subscribe: vi.fn(async () => suscripcion) },
    }));
    instalarNavegador({
      permission: "granted",
      serviceWorker: { register: registrar, getRegistration: async () => null },
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void init;
      if (url === "/api/push/clave") {
        return new Response(JSON.stringify({ clave: "aG9sYQ" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/push/suscripcion") {
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await activarPush()).toBe("activo");
    expect(registrar).toHaveBeenCalledWith("/sw.js");

    const llamadaSuscripcion = fetchMock.mock.calls.find(
      ([url]) => url === "/api/push/suscripcion",
    );
    expect(llamadaSuscripcion).toBeDefined();
    expect(llamadaSuscripcion?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(llamadaSuscripcion?.[1]?.body))).toEqual(suscripcion.toJSON());
  });

  it("avisa si el servidor no tiene push configurado", async () => {
    instalarNavegador({
      permission: "granted",
      serviceWorker: { register: async () => ({ pushManager: { subscribe: vi.fn() } }) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ mensaje: "no" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(activarPush()).rejects.toThrow("Los avisos del servidor no están configurados");
  });

  it("avisa si el permiso no se concede", async () => {
    instalarNavegador({
      permission: "denied",
      serviceWorker: { register: vi.fn() },
    });

    await expect(activarPush()).rejects.toThrow("Permiso bloqueado en el navegador");
  });
});

describe("desactivarPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("cancela la suscripción y la borra en el servidor", async () => {
    const unsubscribe = vi.fn(async () => true);
    instalarNavegador({
      permission: "granted",
      serviceWorker: {
        getRegistration: async () => ({
          pushManager: { getSubscription: async () => ({ ...suscripcion, unsubscribe }) },
        }),
      },
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await desactivarPush();

    expect(unsubscribe).toHaveBeenCalled();
    const llamada = fetchMock.mock.calls.find(([url]) => url === "/api/push/suscripcion");
    expect(llamada?.[1]?.method).toBe("DELETE");
    expect(JSON.parse(String(llamada?.[1]?.body))).toEqual({ endpoint: suscripcion.endpoint });
  });
});
