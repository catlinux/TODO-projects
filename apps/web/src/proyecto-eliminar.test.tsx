import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import ProyectoDetalle from "./paginas/ProyectoDetalle";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function montarFetch(opciones: { esBandeja?: boolean; estadoBorrado?: number } = {}) {
  let borrado = false;
  const peticiones: Array<{ url: string; method: string }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      peticiones.push({ url, method });

      if (url === "/api/proyectos/p1" && method === "GET") {
        return json({
          id: "p1",
          nombre: "Casa",
          propietarioId: "u1",
          esBandeja: opciones.esBandeja ?? false,
          fondo: { tipo: "ambiente", ambiente: "bosque" },
          createdAt: "",
          updatedAt: "",
        });
      }
      if (url === "/api/proyectos/p1/columnas") {
        return json([
          { id: "c1", proyectoId: "p1", nombre: "Pendiente", posicion: 0, createdAt: "", updatedAt: "" },
        ]);
      }
      if (url === "/api/proyectos/p1/tareas") {
        return json([
          {
            id: "t1",
            proyectoId: "p1",
            columnaId: "c1",
            titulo: "Una",
            posicion: 0,
            createdAt: "",
            updatedAt: "",
          },
          {
            id: "t2",
            proyectoId: "p1",
            columnaId: "c1",
            titulo: "Otra",
            posicion: 1,
            createdAt: "",
            updatedAt: "",
          },
        ]);
      }
      if (url === "/api/proyectos/p1/etiquetas") return json([]);
      if (url === "/api/proyectos/p1" && method === "DELETE") {
        if (opciones.estadoBorrado && opciones.estadoBorrado !== 204) {
          return json({ mensaje: "No se pudo borrar" }, opciones.estadoBorrado);
        }
        borrado = true;
        return new Response(null, { status: 204 });
      }
      return json({}, 404);
    }),
  );

  return { peticiones, estaBorrado: () => borrado };
}

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/proyectos/p1"]}>
        <Routes>
          <Route path="/proyectos/:id" element={<ProyectoDetalle />} />
          <Route path="/proyectos" element={<p>Lista de proyectos</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Eliminar proyecto", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("confirma con el nombre y las tareas, borra y navega a /proyectos", async () => {
    const { estaBorrado } = montarFetch();
    const user = userEvent.setup();
    renderizar();

    await user.click(await screen.findByRole("button", { name: "Eliminar proyecto" }));

    expect(
      await screen.findByRole("heading", { name: "Eliminar proyecto" }),
    ).toBeTruthy();
    expect(screen.getByText(/Se eliminará «Casa» y se perderán 2 tareas/)).toBeTruthy();
    expect(screen.getByText(/no se puede deshacer/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    await waitFor(() => expect(estaBorrado()).toBe(true));
    expect(await screen.findByText("Lista de proyectos")).toBeTruthy();
  });

  it("mantiene el diálogo y muestra el error del servidor", async () => {
    montarFetch({ estadoBorrado: 500 });
    const user = userEvent.setup();
    renderizar();

    await user.click(await screen.findByRole("button", { name: "Eliminar proyecto" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByText("No se pudo borrar")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Eliminar proyecto" })).toBeTruthy();
    expect(screen.queryByText("Lista de proyectos")).toBeNull();
  });

  it("no ofrece eliminar la Bandeja de entrada", async () => {
    montarFetch({ esBandeja: true });
    renderizar();

    await screen.findByRole("heading", { name: "Casa" });
    expect(screen.queryByRole("button", { name: "Eliminar proyecto" })).toBeNull();
  });
});
