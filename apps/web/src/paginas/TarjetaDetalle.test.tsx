import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { ColumnaApi, TareaApi } from "../api";
import TarjetaDetalle from "./TarjetaDetalle";

const columnas: ColumnaApi[] = [
  { id: "c1", proyectoId: "p1", nombre: "Pendiente", posicion: 0, createdAt: "", updatedAt: "" },
  { id: "c2", proyectoId: "p1", nombre: "Hecho", posicion: 1, createdAt: "", updatedAt: "" },
];

function tareaBase(extra: Partial<TareaApi> = {}): TareaApi {
  return {
    id: "t1",
    proyectoId: "p1",
    columnaId: "c1",
    titulo: "Tarea de prueba",
    posicion: 0,
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function Ubicacion() {
  const { pathname } = useLocation();
  return <span data-testid="ubicacion">{pathname}</span>;
}

interface OpcionesFetch {
  tarea?: TareaApi;
  errorTarea?: boolean;
}

function montarFetch({ tarea, errorTarea }: OpcionesFetch = {}) {
  let actual = tarea ?? tareaBase();
  const patches: Array<Record<string, unknown>> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      if (url === "/api/tareas/t1" && method === "GET") {
        if (errorTarea) return json({ mensaje: "no encontrada" }, 404);
        return json(actual);
      }
      if (url === "/api/tareas/t1" && method === "PATCH") {
        const cambios = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        patches.push(cambios);
        actual = { ...actual, ...cambios };
        return json(actual);
      }
      if (url === "/api/proyectos/p1/columnas") return json(columnas);
      if (url === "/api/tareas/t1/archivos") return json([]);
      if (url === "/api/proyectos/p1/tareas") return json([]);
      return json({ mensaje: "no encontrado" }, 404);
    }),
  );

  return { patches };
}

function renderTarjeta(entrada = "/proyectos/p1/tareas/t1") {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[entrada]}>
        <Ubicacion />
        <Routes>
          <Route
            path="/proyectos/:id"
            element={
              <>
                <p>Tablero de pruebas</p>
                <Link id="tarjeta-t1" to="/proyectos/p1/tareas/t1">
                  Abrir tarjeta
                </Link>
                <Outlet />
              </>
            }
          >
            <Route path="tareas/:tareaId" element={<TarjetaDetalle />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cliente;
}

describe("TarjetaDetalle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("abrir la URL directamente muestra la tarjeta con su portada", async () => {
    montarFetch({ tarea: tareaBase({ portada: { tipo: "color", valor: "#6e4fe6" } }) });
    renderTarjeta();

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Tarea de prueba" })).toBeTruthy();
    expect(screen.getByTestId("ubicacion").textContent).toBe("/proyectos/p1/tareas/t1");
    expect(document.querySelector(".tarjeta-detalle__portada")).not.toBeNull();
  });

  it("Escape cierra la tarjeta y navega al tablero", async () => {
    montarFetch();
    renderTarjeta();

    const dialogo = await screen.findByRole("dialog");
    fireEvent.keyDown(dialogo, { key: "Escape" });

    await waitFor(() => expect(screen.getByTestId("ubicacion").textContent).toBe("/proyectos/p1"));
    expect(screen.getByText("Tablero de pruebas")).toBeTruthy();
  });

  it("el botón cerrar navega al tablero", async () => {
    montarFetch();
    const user = userEvent.setup();
    renderTarjeta();

    await user.click(await screen.findByRole("button", { name: /cerrar/i }));
    await waitFor(() => expect(screen.getByTestId("ubicacion").textContent).toBe("/proyectos/p1"));
  });

  it("devuelve el foco a la tarjeta del tablero al cerrar", async () => {
    montarFetch();
    renderTarjeta();

    const dialogo = await screen.findByRole("dialog");
    fireEvent.keyDown(dialogo, { key: "Escape" });

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("link", { name: /abrir tarjeta/i })),
    );
  });

  it("editar el título lo guarda con PATCH", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderTarjeta();

    await user.click(await screen.findByRole("button", { name: "Tarea de prueba" }));
    const entrada = screen.getByLabelText(/^título$/i);
    await user.clear(entrada);
    await user.type(entrada, "Título nuevo{Enter}");

    await waitFor(() => expect(patches).toContainEqual({ titulo: "Título nuevo" }));
  });

  it("no guarda un título vacío", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderTarjeta();

    await user.click(await screen.findByRole("button", { name: "Tarea de prueba" }));
    const entrada = screen.getByLabelText(/^título$/i);
    await user.clear(entrada);
    await user.type(entrada, "{Enter}");

    expect(patches).toHaveLength(0);
  });

  it("cambiar la columna envía el PATCH", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderTarjeta();

    await screen.findByRole("button", { name: "Tarea de prueba" });
    await user.selectOptions(screen.getByLabelText(/columna/i), "c2");

    await waitFor(() => expect(patches).toContainEqual({ columnaId: "c2" }));
  });

  it("la casilla «Hecha» mueve a la última y a la primera columna", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderTarjeta();

    const casilla = await screen.findByRole("checkbox", { name: /hecha/i });
    expect((casilla as HTMLInputElement).checked).toBe(false);

    await user.click(casilla);
    await waitFor(() => expect(patches).toContainEqual({ columnaId: "c2" }));

    await waitFor(() => expect((casilla as HTMLInputElement).checked).toBe(true));
    await user.click(casilla);
    await waitFor(() => expect(patches).toContainEqual({ columnaId: "c1" }));
  });

  it("oculta la casilla en las tareas recurrentes", async () => {
    montarFetch({ tarea: tareaBase({ recurrencia: "FREQ=DAILY" }) });
    renderTarjeta();

    await screen.findByRole("button", { name: "Tarea de prueba" });
    expect(screen.queryByRole("checkbox", { name: /hecha/i })).toBeNull();
  });

  it("muestra un mensaje y vuelve al tablero si la tarea no existe", async () => {
    montarFetch({ errorTarea: true });
    const user = userEvent.setup();
    renderTarjeta();

    expect(await screen.findByText(/no existe o no es tuya/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /volver al tablero/i }));
    await waitFor(() => expect(screen.getByTestId("ubicacion").textContent).toBe("/proyectos/p1"));
  });

  it("guarda la descripción y muestra el hueco cuando está vacía", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderTarjeta();

    await user.click(await screen.findByRole("button", { name: /añadir una descripción/i }));
    const area = screen.getByLabelText(/descripción/i);
    await user.type(area, "Una **nota** con formato");
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(patches).toContainEqual({ descripcion: "Una **nota** con formato" }),
    );
  });
});
