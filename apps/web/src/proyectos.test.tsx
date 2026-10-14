import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import Proyectos from "./paginas/Proyectos";

describe("Proyectos", () => {
  afterEach(() => vi.restoreAllMocks());

  it("muestra la lista de proyectos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              id: "p1",
              nombre: "Proyecto de prueba",
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            },
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <Proyectos />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Proyecto de prueba")).toBeTruthy();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
  });
});
