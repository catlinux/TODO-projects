import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./../i18n/index";
import type { ResultadoBusquedaApi } from "../api";
import { CLAVE_ESTILO } from "../estilo";
import { CLAVE_TEMA } from "../tema";
import { Disposicion } from "./Disposicion";
import { Paleta, ESPERA_BUSQUEDA_MS } from "./Paleta";

const VACIO: ResultadoBusquedaApi = { tareas: [], proyectos: [] };

const RESULTADOS: ResultadoBusquedaApi = {
  tareas: [
    {
      id: "t1",
      titulo: "Propuesta de diseño",
      proyectoId: "p1",
      proyectoNombre: "Trabajo",
      proyectoColor: "#123456",
      columnaId: "c1",
      venceEn: null,
      hecha: false,
    },
  ],
  proyectos: [{ id: "p9", nombre: "Proyectos varios", color: null }],
};

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Stub de `fetch` con las rutas que usan la disposición y la paleta. */
function simularFetch(resultados: ResultadoBusquedaApi = VACIO, fallaBusqueda = false) {
  const espia = vi.fn(async (url: string) => {
    if (url === "/api/proyectos") {
      return json([
        { id: "p1", nombre: "Trabajo", propietarioId: "u1", createdAt: "", updatedAt: "" },
      ]);
    }
    if (url === "/api/auth/yo") {
      return json({ id: "u1", email: "a@b.com", nombre: "Marta" });
    }
    if (url.startsWith("/api/agenda?")) {
      return json([]);
    }
    if (url.startsWith("/api/buscar?")) {
      if (fallaBusqueda) {
        return json({ mensaje: "Fallo" }, 500);
      }
      return json(resultados);
    }
    return json({}, 404);
  });
  vi.stubGlobal("fetch", espia);
  return espia;
}

function MostrarRuta() {
  const { pathname, search } = useLocation();
  return <p data-testid="ruta">{pathname + search}</p>;
}

function renderPaleta(resultados: ResultadoBusquedaApi = VACIO, fallaBusqueda = false) {
  simularFetch(resultados, fallaBusqueda);
  const onCerrar = vi.fn();
  const onNuevaTarea = vi.fn();
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utilidades = render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/hoy"]}>
        <MostrarRuta />
        <Paleta abierto onCerrar={onCerrar} onNuevaTarea={onNuevaTarea} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utilidades, onCerrar, onNuevaTarea };
}

function renderDisposicion(ruta = "/hoy") {
  simularFetch();
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <Disposicion>
                  <p>contenido</p>
                </Disposicion>
                <MostrarRuta />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { cliente, user };
}

describe("Paleta", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.tema;
    delete document.documentElement.dataset.estilo;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.tema;
    delete document.documentElement.dataset.estilo;
  });

  it("espera 150 ms antes de consultar /buscar", async () => {
    vi.useFakeTimers();
    const espia = simularFetch(RESULTADOS);
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/hoy"]}>
          <Paleta abierto onCerrar={vi.fn()} onNuevaTarea={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    expect(espia).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ESPERA_BUSQUEDA_MS - 1);
    });
    expect(espia).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia.mock.calls[0]?.[0]).toBe("/api/buscar?q=pro");
  });

  it("navega a la tarea con ↑ ↓ y Enter", async () => {
    renderPaleta(RESULTADOS);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    await screen.findByRole("option", { name: /propuesta de diseño/i });

    const campo = screen.getByRole("combobox");
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "ArrowUp" });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("ruta").textContent).toBe("/proyectos/p1/tareas/t1"),
    );
  });

  it("navega al proyecto seleccionado", async () => {
    renderPaleta(RESULTADOS);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });
    await screen.findByRole("option", { name: /proyectos varios/i });

    const campo = screen.getByRole("combobox");
    fireEvent.keyDown(campo, { key: "ArrowDown" });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(screen.getByTestId("ruta").textContent).toBe("/proyectos/p9"));
  });

  it("cierra con Escape", () => {
    const { onCerrar } = renderPaleta();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  it("filtra las acciones por el texto escrito", async () => {
    renderPaleta();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "agenda" } });

    const lista = screen.getByRole("listbox");
    expect(await within(lista).findByRole("option", { name: /ir a agenda/i })).toBeTruthy();
    expect(within(lista).queryByRole("option", { name: /ir a hoy/i })).toBeNull();
    expect(within(lista).queryByRole("option", { name: /nueva tarea/i })).toBeNull();
  });

  it("avisa cuando no hay resultados", async () => {
    renderPaleta();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });

    expect(await screen.findByText(/sin resultados/i)).toBeTruthy();
  });

  it("muestra un error si la búsqueda falla", async () => {
    renderPaleta(VACIO, true);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pro" } });

    expect(await screen.findByText(/no se pudo buscar/i)).toBeTruthy();
  });

  it("rota el tema claro → oscuro → sistema", async () => {
    renderPaleta();

    const tema = () => screen.getByRole("option", { name: /cambiar tema/i });
    fireEvent.click(tema());
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("claro");
    fireEvent.click(tema());
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("oscuro");
    fireEvent.click(tema());
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("sistema");
  });

  it("alterna el estilo sobrio → sereno → sobrio", async () => {
    renderPaleta();

    const estilo = () => screen.getByRole("option", { name: /cambiar estilo/i });
    fireEvent.click(estilo());
    expect(localStorage.getItem(CLAVE_ESTILO)).toBe("sereno");
    expect(document.documentElement.dataset.estilo).toBe("sereno");

    fireEvent.click(estilo());
    expect(localStorage.getItem(CLAVE_ESTILO)).toBe("sobrio");
    expect(document.documentElement.dataset.estilo).toBe("sobrio");
  });

  it("abre la paleta con Ctrl+K desde una pantalla protegida", async () => {
    renderDisposicion();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("abre la paleta con el botón de la barra lateral", async () => {
    const { user } = renderDisposicion();

    const boton = await screen.findByRole("button", { name: /buscar/i });
    await user.click(boton);

    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("«Nueva tarea» navega al proyecto abierto con ?nueva=1", async () => {
    renderDisposicion("/proyectos/p1");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByRole("option", { name: /nueva tarea/i }));

    await waitFor(() =>
      expect(screen.getByTestId("ruta").textContent).toBe("/proyectos/p1?nueva=1"),
    );
  });

  it("«?» abre la ayuda de atajos desde una pantalla protegida", async () => {
    renderDisposicion();

    fireEvent.keyDown(window, { key: "?" });

    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).getByText(/buscar y comandos/i)).toBeTruthy();
  });
});
