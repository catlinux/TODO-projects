import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import ProyectoDetalle from "./paginas/ProyectoDetalle";
import TarjetaDetalle from "./paginas/TarjetaDetalle";

describe("ProyectoDetalle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
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
    expect(document.querySelector(".fondo-proyecto--bosque")).toBeTruthy();
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

    await user.click(await screen.findByRole("button", { name: /añadir columna/i }));
    await user.type(await screen.findByLabelText(/nombre de la columna/i), "Nueva");
    await user.click(screen.getByRole("button", { name: /añadir columna/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Nueva").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("abre el diálogo de nueva tarea y lo cierra con Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
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

    expect(screen.queryByLabelText(/^título$/i)).toBeNull();

    await user.click(await screen.findByRole("button", { name: /nueva tarea/i }));
    const dialogo = await screen.findByRole("dialog");
    expect(await screen.findByLabelText(/^título$/i)).toBeTruthy();

    fireEvent.keyDown(dialogo, { key: "Escape" });

    await waitFor(() => expect(screen.queryByLabelText(/^título$/i)).toBeNull());
  });

  it("abre el diálogo de nueva tarea con ?nueva=1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
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
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/proyectos/p1?nueva=1"]}>
          <Routes>
            <Route path="/proyectos/:id" element={<ProyectoDetalle />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText(/^título$/i)).toBeTruthy();
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

    await user.click(
      await screen.findByRole("button", { name: /opciones de la tarjeta tarea movable/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /mover a/i }));
    await user.click(screen.getByRole("menuitem", { name: /^en curso$/i }));
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

    const opciones = await screen.findByRole("button", {
      name: /opciones de la columna pendiente/i,
    });
    await user.click(opciones);
    await user.click(screen.getByRole("menuitem", { name: /eliminar columna/i }));

    expect(await screen.findByText("La columna no está vacía")).toBeTruthy();
  });

  it("renombra y mueve una columna desde el menú", async () => {
    const cuerpos: Array<Record<string, unknown>> = [];
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
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/columnas/c1" && method === "PATCH") {
          cuerpos.push(JSON.parse(String(init?.body ?? "{}")));
          return new Response(JSON.stringify({ id: "c1" }), {
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

    await user.click(
      await screen.findByRole("button", { name: /opciones de la columna pendiente/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: /renombrar/i }));

    const campo = await screen.findByLabelText(/nombre de la columna/i);
    await user.clear(campo);
    await user.type(campo, "Backlog");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpos.length).toBeGreaterThanOrEqual(1));
    expect(cuerpos[0]).toMatchObject({ nombre: "Backlog" });

    await user.click(screen.getByRole("button", { name: /opciones de la columna pendiente/i }));
    await user.click(screen.getByRole("menuitem", { name: /mover a la derecha/i }));

    await waitFor(() => expect(cuerpos.length).toBeGreaterThanOrEqual(2));
    expect(cuerpos[1]).toMatchObject({ posicion: 1 });
  });

  it("crea una tarea con fecha y recurrencia", async () => {
    let cuerpoPost: string | null = null;
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
        if (url === "/api/proyectos/p1/tareas" && method === "GET") {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/proyectos/p1/tareas" && method === "POST") {
          cuerpoPost = String(init?.body ?? "");
          return new Response(JSON.stringify({ id: "t1" }), {
            status: 201,
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

    await user.click(await screen.findByRole("button", { name: /nueva tarea/i }));
    await user.type(await screen.findByLabelText(/^título$/i), "Reunión");
    fireEvent.change(screen.getByLabelText(/fecha y hora/i), {
      target: { value: "2026-05-10T10:00" },
    });
    await user.selectOptions(screen.getByLabelText(/frecuencia/i), "semanal");
    fireEvent.change(screen.getByLabelText(/cada/i), { target: { value: "2" } });
    await user.click(screen.getByRole("checkbox", { name: "L" }));
    await user.click(screen.getByRole("checkbox", { name: "X" }));
    await user.selectOptions(screen.getByLabelText(/termina/i), "veces");
    fireEvent.change(screen.getByLabelText(/número de veces/i), { target: { value: "10" } });
    await user.selectOptions(screen.getByLabelText(/avisar antes/i), "15");
    await user.click(screen.getByRole("button", { name: /crear tarea/i }));

    await waitFor(() => expect(cuerpoPost).not.toBeNull());
    expect(JSON.parse(String(cuerpoPost))).toMatchObject({
      titulo: "Reunión",
      venceEn: "2026-05-10T08:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10",
      zona: "Europe/Madrid",
      recordatorioMin: 15,
    });
  });

  it("edita una tarea y quita la fecha", async () => {
    let cuerpoPatch: string | null = null;
    const tareaConFecha = {
      id: "t1",
      proyectoId: "p1",
      columnaId: "c1",
      titulo: "Tarea con fecha",
      posicion: 0,
      venceEn: "2026-05-10T08:00:00.000Z",
      recurrencia: "FREQ=WEEKLY;COUNT=3",
      createdAt: "",
      updatedAt: "",
    };
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
          return new Response(JSON.stringify([tareaConFecha]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/tareas/t1" && method === "GET") {
          return new Response(JSON.stringify(tareaConFecha), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/tareas/t1" && method === "PATCH") {
          cuerpoPatch = String(init?.body ?? "");
          return new Response(JSON.stringify({ id: "t1" }), {
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
            <Route path="/proyectos/:id" element={<ProyectoDetalle />}>
              <Route path="tareas/:tareaId" element={<TarjetaDetalle />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("img", { name: /se repite/i })).toBeTruthy();
    await user.click(await screen.findByRole("link", { name: /tarea con fecha/i }));

    const fecha = await screen.findByLabelText(/fecha y hora/i);
    fireEvent.change(fecha, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpoPatch).not.toBeNull());
    expect(JSON.parse(String(cuerpoPatch))).toMatchObject({
      venceEn: null,
      recurrencia: null,
      zona: "Europe/Madrid",
    });
  });

  it("edita el aviso y lo quita sin borrar la fecha", async () => {
    let cuerpoPatch: string | null = null;
    const tareaConAviso = {
      id: "t1",
      proyectoId: "p1",
      columnaId: "c1",
      titulo: "Con aviso",
      posicion: 0,
      venceEn: "2026-05-10T08:00:00.000Z",
      recurrencia: null,
      recordatorioMin: 60,
      createdAt: "",
      updatedAt: "",
    };
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
          return new Response(JSON.stringify([tareaConAviso]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/tareas/t1" && method === "GET") {
          return new Response(JSON.stringify(tareaConAviso), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (url === "/api/tareas/t1" && method === "PATCH") {
          cuerpoPatch = String(init?.body ?? "");
          return new Response(JSON.stringify({ id: "t1" }), {
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
            <Route path="/proyectos/:id" element={<ProyectoDetalle />}>
              <Route path="tareas/:tareaId" element={<TarjetaDetalle />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("img", { name: /con aviso/i })).toBeTruthy();
    await user.click(await screen.findByRole("link", { name: /con aviso/i }));

    const selector = await screen.findByLabelText(/avisar antes/i);
    await user.selectOptions(selector, "none");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpoPatch).not.toBeNull());
    expect(JSON.parse(String(cuerpoPatch))).toMatchObject({ recordatorioMin: null });
  });

  it("filtra las tarjetas por etiqueta y limpia el filtro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
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
        if (url === "/api/proyectos/p1/etiquetas") {
          return new Response(
            JSON.stringify([
              {
                id: "e1",
                proyectoId: "p1",
                nombre: "Casa",
                color: "#6E4FE6",
                createdAt: "",
                updatedAt: "",
              },
              {
                id: "e2",
                proyectoId: "p1",
                nombre: "Urgente",
                color: "#C8303A",
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
                titulo: "Con casa",
                posicion: 0,
                etiquetas: ["e1"],
                createdAt: "",
                updatedAt: "",
              },
              {
                id: "t2",
                proyectoId: "p1",
                columnaId: "c1",
                titulo: "Con urgente",
                posicion: 1,
                etiquetas: ["e2"],
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

    expect(await screen.findByText("Con casa")).toBeTruthy();
    expect(screen.getByText("Con urgente")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /filtrar/i }));
    await user.click(screen.getByRole("checkbox", { name: "Casa" }));

    await waitFor(() => expect(screen.queryByText("Con urgente")).toBeNull());
    expect(screen.getByText("Con casa")).toBeTruthy();
    expect(screen.getByRole("button", { name: /filtrar/i }).textContent).toContain("1");

    await user.click(screen.getByRole("button", { name: /limpiar/i }));
    expect(await screen.findByText("Con urgente")).toBeTruthy();
  });

  it("abre el diálogo de personalizar con el botón Fondo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/proyectos/p1") {
          return new Response(
            JSON.stringify({
              id: "p1",
              nombre: "Proyecto",
              color: "#2f4bc4",
              fondo: { tipo: "ambiente", ambiente: "bosque" },
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/proyectos/p1/columnas") {
          return new Response(JSON.stringify([]), {
            status: 200,
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

    await user.click(await screen.findByRole("button", { name: /^fondo$/i }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByText("Personalizar proyecto")).toBeTruthy();
  });

  it("alterna entre Tablero y Lista y guarda la elección por proyecto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
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
                titulo: "Tarea compartida",
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

    expect(await screen.findByText("Tarea compartida")).toBeTruthy();
    const radioTablero = screen.getByRole("radio", { name: "Tablero" });
    const radioLista = screen.getByRole("radio", { name: "Lista" });
    expect(radioTablero.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".lista-tareas__panel")).toBeNull();

    await user.click(radioLista);
    expect(screen.getByRole("radio", { name: "Lista" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Tablero" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(document.querySelector(".lista-tareas__panel")).toBeTruthy();
    expect(window.localStorage.getItem("todo.vista.p1")).toBe("lista");
  });

  it("recuerda la vista guardada y cae en Tablero con un valor inválido", async () => {
    const respuestas = (url: string) => {
      if (url === "/api/proyectos/p1") {
        return JSON.stringify({
          id: "p1",
          nombre: "Proyecto",
          propietarioId: "u1",
          createdAt: "",
          updatedAt: "",
        });
      }
      if (url === "/api/proyectos/p1/columnas") {
        return JSON.stringify([
          {
            id: "c1",
            proyectoId: "p1",
            nombre: "Pendiente",
            posicion: 0,
            createdAt: "",
            updatedAt: "",
          },
        ]);
      }
      if (url === "/api/proyectos/p1/tareas") {
        return JSON.stringify([
          {
            id: "t1",
            proyectoId: "p1",
            columnaId: "c1",
            titulo: "Tarea compartida",
            posicion: 0,
            createdAt: "",
            updatedAt: "",
          },
        ]);
      }
      return null;
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const cuerpo = respuestas(url);
        if (cuerpo === null) {
          return new Response(JSON.stringify({}), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(cuerpo, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    window.localStorage.setItem("todo.vista.p1", "lista");
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const montar = () =>
      render(
        <QueryClientProvider client={cliente}>
          <MemoryRouter initialEntries={["/proyectos/p1"]}>
            <Routes>
              <Route path="/proyectos/:id" element={<ProyectoDetalle />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );

    montar();
    expect(await screen.findByText("Tarea compartida")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Lista" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".lista-tareas__panel")).toBeTruthy();

    cleanup();
    window.localStorage.setItem("todo.vista.p1", "otra-cosa");
    montar();
    expect(await screen.findByText("Tarea compartida")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Tablero" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".lista-tareas__panel")).toBeNull();
  });
});
