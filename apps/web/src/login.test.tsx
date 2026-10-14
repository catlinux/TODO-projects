import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import Login from "./paginas/Login";

describe("Login", () => {
  afterEach(() => vi.restoreAllMocks());

  it("inicia sesión correctamente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "1", email: "a@b.com", nombre: "Ana" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
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
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ mensaje: "Credenciales inválidas" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
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

    await user.type(screen.getAllByLabelText(/correo electrónico/i)[1]!, "a@b.com");
    await user.type(screen.getAllByLabelText(/contraseña/i)[1]!, "contrasena-incorrecta");
    await user.click(screen.getAllByRole("button", { name: /entrar/i })[1]!);

    expect(await screen.findByText("Credenciales inválidas")).toBeTruthy();
  });
});
