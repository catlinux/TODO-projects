import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import ProyectoDetalle from "./paginas/ProyectoDetalle";

describe("ProyectoDetalle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra columnas y tareas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url === "/api/proyectos/p1") {
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
        if (url === "/api/proyectos/p1/columnas") {
          return new Response(
            JSON.stringify([
              {
                id: "c1",
                proyectoId: "p1",
                nombre: "Pendiente",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
              {
                id: "c2",
                proyectoId: "p1",
                nombre: "En curso",
                posicion: 1,
                createdAt: "",
                updatedAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/tareas") {
          return new Response(
            JSON.stringify([
              {
                id: "t1",
                proyectoId: "p1",
                columnaId: "c1",
                titulo: "Tarea inicial",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/proyectos/p1"]}>
          <Routes>
            <Route path="/proyectos/:id" element={<ProyectoDetalle />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText("Pendiente")).length).toBeGreaterThan(0);
    expect(await screen.findByText("En curso", { selector: "h3" })).toBeTruthy();
    expect(await screen.findByText("Tarea inicial")).toBeTruthy();
  });

  it("crea una columna", async () => {
    let columnas = [
      {
        id: "c1",
        proyectoId: "p1",
        nombre: "Pendiente",
        posicion: 0,
        createdAt: "",
        updatedAt: "",
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/proyectos/p1") {
          return new Response(
            JSON.stringify({
              id: "p1",
              nombre: "Proyecto",
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/columnas" && method === "GET") {
          return new Response(JSON.stringify(columnas), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/proyectos/p1/columnas" && method === "POST") {
          const nueva = {
            id: "c2",
            proyectoId: "p1",
            nombre: "Nueva",
            posicion: columnas.length,
            createdAt: "",
            updatedAt: "",
          };
          columnas = [...columnas, nueva];
          return new Response(JSON.stringify(nueva), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/proyectos/p1/tareas") {
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

    await screen.findByLabelText(/nombre de la columna/i);
    await user.type(screen.getByLabelText(/nombre de la columna/i), "Nueva");
    await user.click(screen.getByRole("button", { name: /añadir columna/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Nueva").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("mueve una tarea con el selector y envía el PATCH", async () => {
    let movido = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/proyectos/p1") {
          return new Response(
            JSON.stringify({
              id: "p1",
              nombre: "Proyecto",
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/columnas") {
          return new Response(
            JSON.stringify([
              {
                id: "c1",
                proyectoId: "p1",
                nombre: "Pendiente",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
              {
                id: "c2",
                proyectoId: "p1",
                nombre: "En curso",
                posicion: 1,
                createdAt: "",
                updatedAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/tareas") {
          return new Response(
            JSON.stringify([
              {
                id: "t1",
                proyectoId: "p1",
                columnaId: movido ? "c2" : "c1",
                titulo: "Tarea movable",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/tareas/t1" && method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          expect(body).toMatchObject({ columnaId: "c2" });
          movido = true;
          return new Response(
            JSON.stringify({
              id: "t1",
              proyectoId: "p1",
              columnaId: "c2",
              titulo: "Tarea movable",
              posicion: 0,
              createdAt: "",
              updatedAt: "",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
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

    const selector = await screen.findByRole("combobox", { name: /mover a/i });
    await user.selectOptions(selector, "En curso");
    await waitFor(() => expect(movido).toBe(true));
  });

  it("muestra el error al borrar una columna con tareas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/proyectos/p1") {
          return new Response(
            JSON.stringify({
              id: "p1",
              nombre: "Proyecto",
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/columnas") {
          return new Response(
            JSON.stringify([
              {
                id: "c1",
                proyectoId: "p1",
                nombre: "Pendiente",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/tareas") {
          return new Response(
            JSON.stringify([
              {
                id: "t1",
                proyectoId: "p1",
                columnaId: "c1",
                titulo: "Tarea",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/columnas/c1" && method === "DELETE") {
          return new Response(JSON.stringify({ mensaje: "La columna no está vacía" }), {
            status: 409,
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

    const boton = await screen.findByRole("button", { name: /eliminar columna/i });
    await user.click(boton);

    expect(await screen.findByText("La columna no está vacía")).toBeTruthy();
  });
});
