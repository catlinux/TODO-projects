import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import type { OcurrenciaAgenda, ProyectoApi } from "./api";
import App from "./App";
import { fechaCabecera } from "./hoy";
import Hoy from "./paginas/Hoy";

const proyectos: ProyectoApi[] = [
  { id: "p1", nombre: "Casa", propietarioId: "u1", createdAt: "", updatedAt: "" },
];

function ocurrencia(
  tareaId: string,
  titulo: string,
  dias: number,
  cambios: Partial<OcurrenciaAgenda> = {},
): OcurrenciaAgenda {
  const fecha = new Date();
  fecha.setHours(9, 0, 0, 0);
  fecha.setDate(fecha.getDate() + dias);
  return {
    tareaId,
    titulo,
    proyectoId: "p1",
    proyectoNombre: "Casa",
    columnaId: "c1",
    columnaNombre: "Pendiente",
    primeraColumnaId: "c1",
    ultimaColumnaId: "c-last",
    fecha: fecha.toISOString(),
    fechaOriginal: fecha.toISOString(),
    conExcepcion: false,
    esRecurrente: false,
    hecha: false,
    recordatorioMin: null,
    ...cambios,
  };
}

const agenda: OcurrenciaAgenda[] = [
  ocurrencia("t-atrasada", "Atrasada 1", -1),
  ocurrencia("t-hoy", "Hoy pendiente", 0),
  ocurrencia("t-hoy-hecha", "Hoy hecha", 0, { hecha: true }),
  ocurrencia("t-manana", "Mañana con aviso", 1, { recordatorioMin: 15 }),
  ocurrencia("t-lejos", "Dentro de diez días", 10),
];

function respuestaJson(datos: unknown): Response {
  return new Response(JSON.stringify(datos), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface PeticionCapturada {
  method: string;
  url: string;
  body: string | null;
}

function renderHoy(datos: OcurrenciaAgenda[] = agenda) {
  const mutaciones: PeticionCapturada[] = [];
  let llamadasAgenda = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/yo") {
        return respuestaJson({ id: "u1", email: "a@b.com", nombre: "Ana" });
      }
      if (url === "/api/proyectos") {
        return respuestaJson(proyectos);
      }
      if (url.startsWith("/api/agenda?")) {
        llamadasAgenda += 1;
        return respuestaJson(datos);
      }
      if (url.startsWith("/api/tareas/")) {
        mutaciones.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body ? String(init.body) : null,
        });
        return new Response(null, { status: 204 });
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
      <MemoryRouter initialEntries={["/hoy"]}>
        <Routes>
          <Route path="/hoy" element={<Hoy />} />
          <Route path="/proyectos/:id" element={<p>Detalle</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { user, mutaciones: () => mutaciones, llamadasAgenda: () => llamadasAgenda };
}

function principal(): HTMLElement {
  const elemento = document.querySelector(".hoy__principal");
  if (!elemento) {
    throw new Error("No hay lista principal");
  }
  return elemento as HTMLElement;
}

function fila(titulo: string): HTMLElement {
  const elemento = within(principal()).getByText(titulo).closest("li");
  if (!elemento) {
    throw new Error(`No hay fila para «${titulo}»`);
  }
  return elemento;
}

describe("Hoy", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("muestra la cabecera y las tres secciones con sus ocurrencias", async () => {
    renderHoy();

    expect(await screen.findByRole("heading", { name: "Atrasadas" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Próximos días" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Hola, Ana", level: 1 })).toBeTruthy();
    expect(screen.getByText(fechaCabecera(new Date()))).toBeTruthy();

    const atrasadas = screen.getByRole("heading", { name: "Atrasadas" }).closest("section")!;
    expect(within(atrasadas).getByText("Atrasada 1")).toBeTruthy();

    const hoy = screen.getByRole("heading", { name: "Hoy", level: 2 }).closest("section")!;
    expect(within(hoy).getByText("Hoy pendiente")).toBeTruthy();
    expect(within(hoy).getByText("Hoy hecha")).toBeTruthy();

    const proximos = screen.getByRole("heading", { name: "Próximos días" }).closest("section")!;
    expect(within(proximos).getByText("Mañana con aviso")).toBeTruthy();

    expect(screen.queryByText("Dentro de diez días")).toBeNull();

    const enlace = within(fila("Mañana con aviso")).getByRole("link", { name: /casa/i });
    expect(enlace.getAttribute("href")).toBe("/proyectos/p1");
    expect(within(fila("Mañana con aviso")).getByText("09:00")).toBeTruthy();
    expect(within(fila("Mañana con aviso")).getByRole("img", { name: /con aviso/i })).toBeTruthy();
  });

  it("tacha y atenúa las hechas y marca su casilla", async () => {
    renderHoy();

    await screen.findByRole("heading", { name: "Atrasadas" });

    const hecha = fila("Hoy hecha");
    expect(hecha.className).toContain("hoy-fila--hecha");
    expect((within(hecha).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);

    const pendiente = fila("Hoy pendiente");
    expect(pendiente.className).not.toContain("hoy-fila--hecha");
    expect((within(pendiente).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("muestra el saludo, las tres cifras y el progreso por proyecto", async () => {
    renderHoy();

    expect(await screen.findByRole("heading", { name: "Hola, Ana", level: 1 })).toBeTruthy();

    await screen.findByText("1/3");

    const cifras = document.querySelectorAll(".hoy-cifra");
    expect(cifras).toHaveLength(3);
    expect(within(cifras[0] as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(cifras[0] as HTMLElement).getByText("Para hoy")).toBeTruthy();
    expect(within(cifras[1] as HTMLElement).getByText("1")).toBeTruthy();
    expect(within(cifras[1] as HTMLElement).getByText("Atrasadas")).toBeTruthy();
    expect(within(cifras[2] as HTMLElement).getByText(/08:45/)).toBeTruthy();

    const lateral = document.querySelector(".hoy__lateral") as HTMLElement;
    const barra = within(lateral).getByRole("progressbar");
    expect(barra.getAttribute("aria-valuenow")).toBe("1");
    expect(barra.getAttribute("aria-valuemax")).toBe("3");
    expect(within(lateral).getByText("1/3")).toBeTruthy();
    expect(within(lateral).getByRole("link", { name: /casa/i })).toBeTruthy();
  });

  it("mueve a la última columna al marcar una tarea no recurrente", async () => {
    const { user, mutaciones, llamadasAgenda } = renderHoy();

    await screen.findByRole("heading", { name: "Atrasadas" });
    const antes = llamadasAgenda();

    await user.click(within(fila("Hoy pendiente")).getByRole("checkbox"));

    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(mutaciones()[0]).toMatchObject({ method: "PATCH", url: "/api/tareas/t-hoy" });
    expect(JSON.parse(String(mutaciones()[0]!.body))).toEqual({ columnaId: "c-last" });
    await waitFor(() => expect(llamadasAgenda()).toBeGreaterThan(antes));
  });

  it("devuelve a la primera columna al desmarcar una no recurrente", async () => {
    const hecha = ocurrencia("t-hecha", "Ya hecha", 0, { hecha: true });
    const { user, mutaciones } = renderHoy([hecha]);

    await screen.findByText("Ya hecha");
    await user.click(within(fila("Ya hecha")).getByRole("checkbox"));

    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(mutaciones()[0]).toMatchObject({ method: "PATCH", url: "/api/tareas/t-hecha" });
    expect(JSON.parse(String(mutaciones()[0]!.body))).toEqual({ columnaId: "c1" });
  });

  it("marca la ocurrencia de una recurrente por su fecha original", async () => {
    const recurrente = ocurrencia("t-recurrente", "Semanal", 0, {
      esRecurrente: true,
      columnaId: "c1",
      ultimaColumnaId: "c-last",
      fechaOriginal: new Date("2026-05-11T09:00:00.000Z").toISOString(),
    });
    const { user, mutaciones } = renderHoy([recurrente]);

    await screen.findByText("Semanal");
    await user.click(within(fila("Semanal")).getByRole("checkbox"));

    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(mutaciones()[0]).toMatchObject({
      method: "POST",
      url: "/api/tareas/t-recurrente/ocurrencias",
    });
    expect(JSON.parse(String(mutaciones()[0]!.body))).toEqual({
      fecha: recurrente.fechaOriginal,
      hecha: true,
    });
  });

  it("mueve solo la ocurrencia recurrente con un diálogo de fecha y hora", async () => {
    const recurrente = ocurrencia("t-recurrente", "Semanal", 0, {
      esRecurrente: true,
      fechaOriginal: new Date("2026-05-11T09:00:00.000Z").toISOString(),
    });
    const { user, mutaciones } = renderHoy([recurrente]);

    await screen.findByText("Semanal");
    await user.click(
      within(fila("Semanal")).getByRole("button", { name: /opciones de «semanal»/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Mover solo esta…" }));

    const dialogo = await screen.findByRole("dialog", { name: "Mover solo esta ocurrencia" });
    fireEvent.change(within(dialogo).getByLabelText("Nueva fecha y hora"), {
      target: { value: "2026-05-12T11:30" },
    });
    await user.click(within(dialogo).getByRole("button", { name: "Mover" }));

    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(mutaciones()[0]).toMatchObject({
      method: "PUT",
      url: "/api/tareas/t-recurrente/excepciones",
    });
    expect(JSON.parse(String(mutaciones()[0]!.body))).toEqual({
      fechaOriginal: recurrente.fechaOriginal,
      fechaNueva: new Date("2026-05-12T11:30").toISOString(),
    });
  });

  it("omite solo la ocurrencia recurrente", async () => {
    const recurrente = ocurrencia("t-recurrente", "Semanal", 0, {
      esRecurrente: true,
      fechaOriginal: new Date("2026-05-11T09:00:00.000Z").toISOString(),
    });
    const { user, mutaciones } = renderHoy([recurrente]);

    await screen.findByText("Semanal");
    await user.click(
      within(fila("Semanal")).getByRole("button", { name: /opciones de «semanal»/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Omitir solo esta" }));

    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(mutaciones()[0]).toMatchObject({
      method: "PUT",
      url: "/api/tareas/t-recurrente/excepciones",
    });
    expect(JSON.parse(String(mutaciones()[0]!.body))).toEqual({
      fechaOriginal: recurrente.fechaOriginal,
      omitida: true,
    });
  });

  it("marca con excepción y restaura la ocurrencia recurrente", async () => {
    const recurrente = ocurrencia("t-recurrente", "Semanal", 0, {
      esRecurrente: true,
      conExcepcion: true,
      fechaOriginal: new Date("2026-05-11T09:00:00.000Z").toISOString(),
    });
    const { user, mutaciones } = renderHoy([recurrente]);

    await screen.findByText("Semanal");
    expect(within(fila("Semanal")).getByRole("img", { name: "Con excepción" })).toBeTruthy();

    await user.click(
      within(fila("Semanal")).getByRole("button", { name: /opciones de «semanal»/i }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Restaurar" }));

    await waitFor(() => expect(mutaciones()).toHaveLength(1));
    expect(mutaciones()[0]).toMatchObject({ method: "DELETE" });
    expect(mutaciones()[0]!.url).toBe(
      `/api/tareas/t-recurrente/excepciones?fechaOriginal=${encodeURIComponent(
        recurrente.fechaOriginal,
      )}`,
    );
  });

  it("no ofrece «Restaurar» si la ocurrencia no tiene excepción", async () => {
    const recurrente = ocurrencia("t-recurrente", "Semanal", 0, {
      esRecurrente: true,
    });
    const { user } = renderHoy([recurrente]);

    await screen.findByText("Semanal");
    await user.click(
      within(fila("Semanal")).getByRole("button", { name: /opciones de «semanal»/i }),
    );

    expect(screen.queryByRole("menuitem", { name: "Restaurar" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Omitir solo esta" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Con excepción" })).toBeNull();
  });

  it("avisa cuando no hay nada pendiente", async () => {
    renderHoy([]);

    expect(await screen.findByText("No hay nada pendiente. ¡Buen trabajo!")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Atrasadas" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Hoy", level: 2 })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Próximos días" })).toBeNull();
  });

  it("la raíz redirige a «Hoy»", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/yo") {
          return respuestaJson({ id: "u1", email: "a@b.com", nombre: "Ana" });
        }
        if (url === "/api/proyectos") {
          return respuestaJson(proyectos);
        }
        if (url.startsWith("/api/agenda?")) {
          return respuestaJson(agenda);
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
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Hola, Ana", level: 1 })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Atrasadas" })).toBeTruthy();
  });
});
