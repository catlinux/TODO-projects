import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import { type TareaApi } from "./api";
import ProyectoDetalle from "./paginas/ProyectoDetalle";

describe("ProyectoDetalle", () => {
  afterEach(() => vi.restoreAllMocks());

  it("crea una tarea y cambia su estado", async () => {
    let tareas: TareaApi[] = [
      {
        id: "t1",
        proyectoId: "p1",
        titulo: "Tarea inicial",
        estado: "pendiente",
        createdAt: "",
        updatedAt: "",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/proyectos/p1" && method === "GET") {
          return new Response(
            JSON.stringify({
              id: "p1",
              nombre: "Proyecto",
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (url === "/api/proyectos/p1/tareas" && method === "GET") {
          return new Response(JSON.stringify(tareas), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/proyectos/p1/tareas" && method === "POST") {
          const nueva = {
            id: "t2",
            proyectoId: "p1",
            titulo: "Nueva tarea",
            estado: "pendiente" as const,
            createdAt: "",
            updatedAt: "",
          };
          tareas = [...tareas, nueva];
          return new Response(JSON.stringify(nueva), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/tareas/t1" && method === "PATCH") {
          tareas = tareas.map((t) => (t.id === "t1" ? { ...t, estado: "hecha" as const } : t));
          return new Response(JSON.stringify(tareas.find((t) => t.id === "t1")), {
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

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/proyectos/p1"]}>
          <Routes>
            <Route path="/proyectos/:id" element={<ProyectoDetalle />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Tarea inicial")).toBeTruthy();

    await user.type(screen.getByLabelText(/título/i), "Nueva tarea");
    await user.click(screen.getByRole("button", { name: /crear tarea/i }));
    expect(await screen.findByText("Nueva tarea")).toBeTruthy();

    const selector = screen.getAllByDisplayValue("Pendiente")[0]!;
    await user.selectOptions(selector, "hecha");
    await waitFor(() => expect((selector as HTMLSelectElement).value).toBe("hecha"));
  });
});
