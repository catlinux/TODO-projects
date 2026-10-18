import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { OcurrenciaAgenda, ProyectoApi, TareaApi } from "../api";
import { CLAVE_TEMA } from "../tema";
import { BarraNavegacion } from "./BarraNavegacion";

const proyectos: ProyectoApi[] = [
  { id: "p1", nombre: "Casa", propietarioId: "u1", createdAt: "", updatedAt: "", color: null },
  { id: "p2", nombre: "Trabajo", propietarioId: "u1", createdAt: "", updatedAt: "" },
  {
    id: "p3",
    nombre: "Viaje",
    propietarioId: "u1",
    createdAt: "",
    updatedAt: "",
    color: "#123456",
  },
];

const usuario = { id: "u1", email: "a@b.com", nombre: "Marta" };

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
    primeraColumnaId: "c1",
    ultimaColumnaId: "c-last",
    fecha: fecha.toISOString(),
    esRecurrente: false,
    hecha,
    recordatorioMin: null,
  };
}

function tareaBandeja(id: string): TareaApi {
  return {
    id,
    proyectoId: "b1",
    columnaId: "cb",
    titulo: `Tarea ${id}`,
    posicion: 0,
    venceEn: null,
    createdAt: "",
    updatedAt: "",
  };
}

/** Devuelve el color tal y como lo normaliza el DOM (hex → rgb). */
function rgb(hex: string): string {
  const valor = hex.replace("#", "");
  const r = parseInt(valor.slice(0, 2), 16);
  const g = parseInt(valor.slice(2, 4), 16);
  const b = parseInt(valor.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function renderMenu(
  ruta: string,
  ocurrencias: OcurrenciaAgenda[] = [],
  tareasBandeja: TareaApi[] = [],
) {
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
      if (url === "/api/bandeja") {
        return new Response(
          JSON.stringify({
            proyecto: {
              id: "b1",
              nombre: "Bandeja de entrada",
              propietarioId: "u1",
              createdAt: "",
              updatedAt: "",
            },
            columnas: [
              {
                id: "cb",
                proyectoId: "b1",
                nombre: "Entrada",
                posicion: 0,
                createdAt: "",
                updatedAt: "",
              },
            ],
            tareas: tareasBandeja,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/auth/yo") {
        return new Response(JSON.stringify(usuario), {
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
  cliente.setQueryData(["yo"], usuario);

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
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.tema;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.tema;
  });

  it("enlaza Hoy, Agenda y Ajustes", () => {
    renderMenu("/proyectos");

    const menu = menuLateral();
    expect(within(menu).getByRole("link", { name: /hoy/i }).getAttribute("href")).toBe("/hoy");
    expect(
      within(menu)
        .getByRole("link", { name: /agenda/i })
        .getAttribute("href"),
    ).toBe("/agenda");
    expect(
      within(menu)
        .getByRole("link", { name: /ajustes/i })
        .getAttribute("href"),
    ).toBe("/ajustes");
  });

  it("enlaza la Bandeja de entrada y cuenta sus pendientes", async () => {
    renderMenu("/bandeja", [], [tareaBandeja("t1"), tareaBandeja("t2")]);

    const menu = menuLateral();
    const enlace = within(menu).getByRole("link", { name: /bandeja de entrada/i });
    expect(enlace.getAttribute("href")).toBe("/bandeja");
    expect(await within(enlace).findByText("2")).toBeTruthy();
  });

  it("oculta el contador de la Bandeja cuando está vacía", () => {
    renderMenu("/bandeja");

    const enlace = within(menuLateral()).getByRole("link", { name: /bandeja de entrada/i });
    expect(enlace.querySelector(".menu-lateral__contador")).toBeNull();
  });

  it("cierra la sesión, limpia la caché y navega a login", async () => {    const { cliente, user, seCerroSesion } = renderMenu("/proyectos");

    expect(
      within(menuLateral())
        .getByRole("link", { name: /agenda/i })
        .getAttribute("href"),
    ).toBe("/agenda");
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

    expect(
      within(menu)
        .getByRole("link", { name: /nuevo proyecto/i })
        .getAttribute("href"),
    ).toBe("/proyectos");
  });

  it("pinta el cuadrado del proyecto con su inicial y color", () => {
    renderMenu("/hoy");

    const menu = menuLateral();
    const cuadrado = (nombre: string) => {
      const enlace = within(menu).getByRole("link", { name: new RegExp(nombre, "i") });
      return enlace.querySelector(".menu-lateral__color") as HTMLElement;
    };

    // Sin color propio, usa la paleta por orden; con color, respeta el del proyecto.
    expect(cuadrado("casa").textContent).toBe("C");
    expect(cuadrado("casa").style.backgroundColor).toBe(rgb("#2f4bc4"));
    expect(cuadrado("trabajo").textContent).toBe("T");
    expect(cuadrado("trabajo").style.backgroundColor).toBe(rgb("#2f8f62"));
    expect(cuadrado("viaje").textContent).toBe("V");
    expect(cuadrado("viaje").style.backgroundColor).toBe(rgb("#123456"));
  });

  it("muestra el perfil del usuario", () => {
    renderMenu("/hoy");

    const menu = menuLateral();
    expect(within(menu).getByText("Marta")).toBeTruthy();
    expect(within(menu).getByText("M")).toBeTruthy();
  });

  it("cambia el tema con el selector", async () => {
    const { user } = renderMenu("/hoy");

    const selector = within(menuLateral()).getByLabelText("Tema") as HTMLSelectElement;
    expect(selector.value).toBe("sistema");

    await user.selectOptions(selector, "oscuro");

    expect(selector.value).toBe("oscuro");
    expect(document.documentElement.dataset.tema).toBe("oscuro");
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("oscuro");
  });

  it("marca el enlace de la barra inferior según la ruta", () => {
    renderMenu("/agenda");

    const inferior = screen.getByRole("navigation", { name: "Navegación inferior" });
    expect(
      within(inferior)
        .getByRole("link", { name: /agenda/i })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(inferior)
        .getByRole("link", { name: /proyectos/i })
        .getAttribute("aria-current"),
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
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/bandeja");

    const inferior = screen.getByRole("navigation", { name: "Navegación inferior" });
    expect(within(inferior).getByRole("link", { name: /hoy/i }).getAttribute("href")).toBe("/hoy");
  });
});

function menuLateral(): HTMLElement {
  return screen.getByRole("navigation", { name: "Menú lateral" });
}
