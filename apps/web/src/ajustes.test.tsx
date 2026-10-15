import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
      <Ajustes />
    </QueryClientProvider>,
  );
  return { cliente, user };
}

describe("Ajustes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
});
