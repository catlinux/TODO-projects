import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import Login from "./paginas/Login";

describe("Login", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("inicia sesión correctamente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/metodos") {
          return new Response(
            JSON.stringify({ correo: true, registro: true, pin: false, huella: false }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ id: "1", email: "a@b.com", nombre: "Ana" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByLabelText(/correo electrónico/i);
    await user.type(screen.getByLabelText(/correo electrónico/i), "a@b.com");
    await user.type(screen.getByLabelText(/contraseña/i), "contrasena-muy-larga");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("muestra un error si falla el login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/metodos") {
          return new Response(
            JSON.stringify({ correo: true, registro: true, pin: false, huella: false }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ mensaje: "Credenciales inválidas" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByLabelText(/correo electrónico/i);
    await user.type(screen.getByLabelText(/correo electrónico/i), "a@b.com");
    await user.type(screen.getByLabelText(/contraseña/i), "contrasena-incorrecta");
    await user.click(screen.getByRole("button", { name: /entrar/i }));

    expect(await screen.findByText("Credenciales inválidas")).toBeTruthy();
  });

  function stubServidor(metodos: object, otras: Record<string, Response> = {}) {
    const llamadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        llamadas.push(url);
        if (url === "/api/auth/metodos") {
          return new Response(JSON.stringify(metodos), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return (
          otras[url]?.clone() ??
          new Response(JSON.stringify({ id: "1", email: "a@b.com", nombre: "Ana" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }),
    );
    return llamadas;
  }

  function renderLogin() {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return userEvent.setup();
  }

  const conHuellaDisponible = (disponible: boolean) =>
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(disponible),
    });

  it("en modo personal muestra solo el PIN y entra con él", async () => {
    const llamadas = stubServidor({ correo: false, registro: false, pin: true, huella: false });
    const user = renderLogin();

    await user.type(await screen.findByLabelText("PIN"), "246813");
    expect(screen.queryByLabelText(/correo electrónico/i)).toBeNull();
    expect(screen.queryByText(/crear cuenta|regístrate/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: /entrar$/i }));

    await waitFor(() => expect(llamadas).toContain("/api/auth/pin"));
  });

  it("muestra el error del PIN incorrecto", async () => {
    stubServidor(
      { correo: false, registro: false, pin: true, huella: false },
      {
        "/api/auth/pin": new Response(JSON.stringify({ mensaje: "PIN incorrecto" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      },
    );
    const user = renderLogin();
    await user.type(await screen.findByLabelText("PIN"), "000000");
    await user.click(screen.getByRole("button", { name: /entrar$/i }));
    expect(await screen.findByText("PIN incorrecto")).toBeTruthy();
  });

  it("muestra el botón de huella solo si el servidor y el dispositivo la admiten", async () => {
    conHuellaDisponible(false);
    stubServidor({ correo: false, registro: false, pin: true, huella: true });
    renderLogin();
    await screen.findByLabelText("PIN");
    expect(screen.queryByRole("button", { name: /entrar con huella/i })).toBeNull();
    cleanup();

    conHuellaDisponible(true);
    stubServidor({ correo: false, registro: false, pin: true, huella: true });
    renderLogin();
    expect(await screen.findByRole("button", { name: /entrar con huella/i })).toBeTruthy();
  });

  it("tras entrar con PIN propone activar la huella y recuerda «Ahora no»", async () => {
    conHuellaDisponible(true);
    stubServidor({ correo: false, registro: false, pin: true, huella: false });
    const user = renderLogin();
    await user.type(await screen.findByLabelText("PIN"), "246813");
    await user.click(screen.getByRole("button", { name: /entrar$/i }));

    expect(await screen.findByText(/entrar con huella en este dispositivo/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /ahora no/i }));
    expect(localStorage.getItem("todo.huellaAhoraNo")).toBe("1");
  });
});
