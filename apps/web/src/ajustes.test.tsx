import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import "./i18n/index";
import Ajustes from "./paginas/Ajustes";

interface TokenListado {
  id: string;
  nombre: string;
  permiso: string;
  prefijo: string;
  ultimoUso: string | null;
  expiraEn: string | null;
  revocadoEn: string | null;
  createdAt: string;
}

function renderAjustes() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <Ajustes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { cliente, user };
}

describe("Ajustes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("crea un token y solo lo muestra al crearlo", async () => {
    let listado: TokenListado[] = [];
    let cuerpoPost: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/tokens" && method === "POST") {
          cuerpoPost = String(init?.body ?? "");
          const creado = {
            id: "t1",
            nombre: "MCP",
            permiso: "calendario",
            prefijo: "tdp_abcd",
            expiraEn: null,
            token: "tdp_abcd-secreto",
          };
          listado = [
            {
              id: "t1",
              nombre: "MCP",
              permiso: "calendario",
              prefijo: "tdp_abcd",
              ultimoUso: null,
              expiraEn: null,
              revocadoEn: null,
              createdAt: "",
            },
          ];
          return new Response(JSON.stringify(creado), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/tokens") {
          return new Response(JSON.stringify(listado), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/actividad") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAjustes();
    await user.type(await screen.findByLabelText(/^nombre$/i), "MCP");
    await user.selectOptions(screen.getByLabelText(/permiso/i), "calendario");
    await user.click(screen.getByRole("button", { name: /crear token/i }));

    expect(await screen.findByText("tdp_abcd-secreto")).toBeTruthy();
    expect(screen.getByText(/no se volverá a mostrar/i)).toBeTruthy();
    expect(screen.getByText(/api\/agenda\.ics\?token=tdp_abcd-secreto/)).toBeTruthy();
    expect(JSON.parse(String(cuerpoPost))).toMatchObject({ nombre: "MCP", permiso: "calendario" });

    await waitFor(() => expect(screen.getByText("tdp_abcd")).toBeTruthy());
  });

  it("lista los tokens y permite revocarlos", async () => {
    let urlBorrada: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/tokens/t1" && method === "DELETE") {
          urlBorrada = url;
          return new Response(null, { status: 204 });
        }
        if (url === "/api/tokens") {
          return new Response(
            JSON.stringify([
              {
                id: "t1",
                nombre: "Existente",
                permiso: "lectura",
                prefijo: "tdp_abcd",
                ultimoUso: null,
                expiraEn: null,
                revocadoEn: null,
                createdAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/actividad") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAjustes();
    expect(await screen.findByText("Existente")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /revocar/i }));
    await waitFor(() => expect(urlBorrada).toBe("/api/tokens/t1"));
  });

  it("muestra la actividad del conector y permite deshacerla", async () => {
    let deshecha = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/actividad/a1/deshacer" && method === "POST") {
          deshecha = true;
          return new Response(null, { status: 204 });
        }
        if (url === "/api/actividad") {
          return new Response(
            JSON.stringify([
              {
                id: "a1",
                accion: "editar",
                entidad: "tarea",
                entidadId: "t1",
                tokenNombre: "Conector",
                antes: null,
                despues: null,
                deshechoEn: null,
                createdAt: "2026-05-10T10:00:00.000Z",
                titulo: "Tarea editada",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/tokens") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAjustes();
    expect(await screen.findByText(/Editó: Tarea editada/)).toBeTruthy();
    expect(screen.getByText("Conector")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /deshacer/i }));
    await waitFor(() => expect(deshecha).toBe(true));
  });

  it("muestra el mensaje del servidor si no se puede deshacer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/actividad/a1/deshacer" && method === "POST") {
          return new Response(JSON.stringify({ mensaje: "La tarea ha cambiado desde entonces" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/actividad") {
          return new Response(
            JSON.stringify([
              {
                id: "a1",
                accion: "borrar",
                entidad: "tarea",
                entidadId: "t1",
                tokenNombre: "Conector",
                antes: null,
                despues: null,
                deshechoEn: null,
                createdAt: "2026-05-10T10:00:00.000Z",
                titulo: "Borrada",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/tokens") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAjustes();
    expect(await screen.findByText(/Borró: Borrada/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /deshacer/i }));

    expect(await screen.findByText("La tarea ha cambiado desde entonces")).toBeTruthy();
  });

  it("deshabilita el botón si la actividad ya está deshecha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/actividad") {
          return new Response(
            JSON.stringify([
              {
                id: "a1",
                accion: "crear",
                entidad: "tarea",
                entidadId: "t1",
                tokenNombre: "Conector",
                antes: null,
                despues: null,
                deshechoEn: "2026-05-11T10:00:00.000Z",
                createdAt: "2026-05-10T10:00:00.000Z",
                titulo: "Creada",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/tokens") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderAjustes();
    expect(await screen.findByText(/Creó: Creada/)).toBeTruthy();
    const boton = screen.getByRole("button", { name: /deshecho/i }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });

  it("lista los dispositivos con huella y permite borrarlos", async () => {
    let huellas = [
      {
        id: "h1",
        nombre: "Android",
        createdAt: "2026-10-15T08:00:00.000Z",
        ultimoUso: null as string | null,
      },
    ];
    const borrados: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/auth/huella/h1" && method === "DELETE") {
          borrados.push("h1");
          huellas = [];
          return new Response(null, { status: 204 });
        }
        const cuerpo = url === "/api/auth/huella" ? huellas : [];
        return new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { user } = renderAjustes();
    expect(await screen.findByText("Android")).toBeTruthy();
    expect(screen.getByText("Nunca")).toBeTruthy();
    expect(screen.getByText(/deploy\/fijar-pin\.sh/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(borrados).toEqual(["h1"]));
    expect(await screen.findByText(/no hay dispositivos con huella/i)).toBeTruthy();
  });

  it("cierra las demás sesiones y muestra cuántas se cerraron", async () => {
    let llamado = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/auth/cerrar-sesiones" && method === "POST") {
          llamado = true;
          return new Response(JSON.stringify({ cerradas: 3 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { user } = renderAjustes();
    await user.click(await screen.findByRole("button", { name: /cerrar las demás sesiones/i }));

    await waitFor(() => expect(llamado).toBe(true));
    expect(await screen.findByText(/sesiones cerradas: 3/i)).toBeTruthy();
  });

  it("pide volver a entrar si la sesión es antigua al activar la huella", async () => {
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: {
        create: vi.fn().mockResolvedValue({
          id: "cred-1",
          response: {
            clientDataJSON: new Uint8Array([1]).buffer,
            getAuthenticatorData: () => new Uint8Array([2]).buffer,
            getPublicKey: () => new Uint8Array([3]).buffer,
            getPublicKeyAlgorithm: () => -7,
          },
        }),
      },
    });
    let logoutLlamado = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/auth/huella/registro-opciones" && method === "POST") {
          return new Response(
            JSON.stringify({
              mensaje: "Vuelve a entrar para añadir un dispositivo",
              codigo: "reautenticar",
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/auth/logout" && method === "POST") {
          logoutLlamado = true;
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAjustes();
    await user.click(await screen.findByRole("button", { name: /activar huella/i }));

    expect(await screen.findByText(/por seguridad, vuelve a entrar/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /salir y volver a entrar/i }));
    await waitFor(() => expect(logoutLlamado).toBe(true));
  });

  it("cierra la sesión desde Ajustes", async () => {
    let logoutLlamado = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/auth/logout" && method === "POST") {
          logoutLlamado = true;
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAjustes();
    await user.click(await screen.findByRole("button", { name: /^cerrar sesión$/i }));

    await waitFor(() => expect(logoutLlamado).toBe(true));
  });
});
