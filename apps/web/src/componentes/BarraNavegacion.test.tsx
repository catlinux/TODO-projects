import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import { BarraNavegacion } from "./BarraNavegacion";

describe("BarraNavegacion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("cierra la sesión, limpia la caché y navega a login", async () => {
    let logoutLlamado = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/logout" && String(init?.method) === "POST") {
          logoutLlamado = true;
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cliente.setQueryData(["proyectos"], [{ id: "p1" }]);

    const user = userEvent.setup();
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/proyectos"]}>
          <Routes>
            <Route path="/proyectos" element={<BarraNavegacion />} />
            <Route path="/login" element={<p>Acceso</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("link", { name: /agenda/i }).getAttribute("href")).toBe("/agenda");
    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    await waitFor(() => expect(logoutLlamado).toBe(true));
    expect(await screen.findByText("Acceso")).toBeTruthy();
    expect(cliente.getQueryData(["proyectos"])).toBeUndefined();
  });
});
