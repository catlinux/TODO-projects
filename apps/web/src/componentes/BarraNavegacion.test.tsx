import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { OcurrenciaAgenda, ProyectoApi } from "../api";
import { BarraNavegacion } from "./BarraNavegacion";

const proyectos: ProyectoApi[] = [
  { id: "p1", nombre: "Casa", propietarioId: "u1", createdAt: "", updatedAt: "" },
  { id: "p2", nombre: "Trabajo", propietarioId: "u1", createdAt: "", updatedAt: "" },
];

function ocurrencia(tareaId: string, dias: number, hecha = false): OcurrenciaAgenda {
  const fecha = new Date();
  fecha.setHours(9, 0, 0, 0);
  fecha.setDate(fecha.getDate() + dias);
  return {
    tareaId,
    titulo: `Tarea ${tareaId}`,
    proyectoId: "p1",
    proyectoNombre: "Casa",
    columnaId: "c1",
    columnaNombre: "Pendiente",
    fecha: fecha.toISOString(),
    esRecurrente: false,
    hecha,
    recordatorioMin: null,
  };
}

function renderMenu(ruta: string, ocurrencias: OcurrenciaAgenda[] = []) {
  let logoutLlamado = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/proyectos") {
        return new Response(JSON.stringify(proyectos), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.startsWith("/api/agenda?")) {
        return new Response(JSON.stringify(ocurrencias), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
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
  cliente.setQueryData(["proyectos"], proyectos);

  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="*" element={<BarraNavegacion />} />
          <Route path="/login" element={<p>Acceso</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { cliente, user, seCerroSesion: () => logoutLlamado };
}

describe("BarraNavegacion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("cierra la sesión, limpia la caché y navega a login", async () => {
    const { cliente, user, seCerroSesion } = renderMenu("/proyectos");

    expect(within(menuLateral()).getByRole("link", { name: /agenda/i }).getAttribute("href")).toBe(
      "/agenda",
    );
    await user.click(screen.getByRole("button", { name: /cerrar sesión/i }));

    await waitFor(() => expect(seCerroSesion()).toBe(true));
    expect(await screen.findByText("Acceso")).toBeTruthy();
    expect(cliente.getQueryData(["proyectos"])).toBeUndefined();
  });

  it("lista los proyectos y resalta el enlace activo", () => {
    renderMenu("/proyectos/p1");

    const menu = menuLateral();
    const casa = within(menu).getByRole("link", { name: /casa/i });
    expect(casa.getAttribute("href")).toBe("/proyectos/p1");
    expect(casa.getAttribute("aria-current")).toBe("page");

    const trabajo = within(menu).getByRole("link", { name: /trabajo/i });
    expect(trabajo.getAttribute("href")).toBe("/proyectos/p2");
    expect(trabajo.getAttribute("aria-current")).toBeNull();

    expect(within(menu).getByRole("link", { name: /nuevo proyecto/i }).getAttribute("href")).toBe(
      "/proyectos",
    );
  });

  it("marca el enlace de la barra inferior según la ruta", () => {
    renderMenu("/agenda");

    const inferior = screen.getByRole("navigation", { name: "Navegación inferior" });
    expect(within(inferior).getByRole("link", { name: /agenda/i }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      within(inferior).getByRole("link", { name: /proyectos/i }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("abre con «Hoy» y cuenta las pendientes en el menú", async () => {
    renderMenu("/hoy", [
      ocurrencia("atrasada", -1),
      ocurrencia("hoy", 0),
      ocurrencia("hoy-hecha", 0, true),
      ocurrencia("manana", 1),
    ]);

    const menu = menuLateral();
    const hoy = within(menu).getByRole("link", { name: /hoy/i });
    expect(hoy.getAttribute("href")).toBe("/hoy");
    expect(await within(hoy).findByText("2")).toBeTruthy();
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/hoy");

    const inferior = screen.getByRole("navigation", { name: "Navegación inferior" });
    expect(within(inferior).getByRole("link", { name: /hoy/i }).getAttribute("href")).toBe("/hoy");
  });
});

function menuLateral(): HTMLElement {
  return screen.getByRole("navigation", { name: "Menú lateral" });
}
