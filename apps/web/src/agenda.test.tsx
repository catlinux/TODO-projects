import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");
  return {
    default: (props: {
      datesSet?: (info: { startStr: string; endStr: string }) => void;
      events?: Array<{ classNames?: string[] }>;
    }) => {
      React.useEffect(() => {
        props.datesSet?.({
          startStr: "2026-05-01T00:00:00.000Z",
          endStr: "2026-06-01T00:00:00.000Z",
        });
      }, []);
      const eventos = props.events ?? [];
      const hechas = eventos.filter((evento) => evento.classNames?.includes("hecha")).length;
      return React.createElement(
        "div",
        { "data-testid": "calendario" },
        `${eventos.length} eventos (${hechas} hechas)`,
      );
    },
  };
});

import "./i18n/index";
import Agenda from "./paginas/Agenda";

const ocurrencias = [
  {
    tareaId: "t1",
    titulo: "Reunión",
    proyectoId: "p1",
    proyectoNombre: "Proyecto",
    columnaId: "c1",
    columnaNombre: "Pendiente",
    fecha: "2026-05-10T08:00:00.000Z",
    esRecurrente: false,
    hecha: true,
  },
  {
    tareaId: "t2",
    titulo: "Demostración",
    proyectoId: "p1",
    proyectoNombre: "Proyecto",
    columnaId: "c1",
    columnaNombre: "Pendiente",
    fecha: "2026-05-10T15:00:00.000Z",
    esRecurrente: false,
    hecha: false,
  },
];

function renderAgenda() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/agenda"]}>
        <Routes>
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/proyectos/:id" element={<p>Detalle</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { cliente, user };
}

describe("Agenda", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("agrupa las ocurrencias por día y marca las hechas", async () => {
    let cuerpoPost: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/tareas/t1/ocurrencias" && init?.method === "POST") {
          cuerpoPost = String(init.body ?? "");
          return new Response(null, { status: 204 });
        }
        if (url.startsWith("/api/agenda?")) {
          return new Response(JSON.stringify(ocurrencias), {
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

    const { user } = renderAgenda();

    expect(await screen.findByText(/10 de mayo/i)).toBeTruthy();
    const enlace = await screen.findByRole("link", { name: /Reunión/ });
    expect(enlace.getAttribute("href")).toBe("/proyectos/p1");
    expect(enlace.closest("li")?.className).toContain("agenda-hecha");

    const casillas = screen.getAllByLabelText(/hecha/i);
    expect((casillas[0] as HTMLInputElement).checked).toBe(true);
    expect((casillas[1] as HTMLInputElement).checked).toBe(false);

    const descarga = screen.getByRole("link", { name: /descargar calendario/i });
    expect(descarga.getAttribute("href")).toBe("/api/agenda.ics");

    await user.click(casillas[0]!);
    await waitFor(() => expect(cuerpoPost).not.toBeNull());
    expect(JSON.parse(String(cuerpoPost))).toEqual({
      fecha: "2026-05-10T08:00:00.000Z",
      hecha: false,
    });
  });

  it("carga el calendario con el rango visible y marca los eventos hechos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/agenda?")) {
          return new Response(JSON.stringify(ocurrencias), {
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

    const { user } = renderAgenda();
    await user.click(screen.getByRole("button", { name: /calendario/i }));

    expect(await screen.findByTestId("calendario")).toBeTruthy();
    expect(await screen.findByText("2 eventos (1 hechas)")).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/api/agenda?desde=2026-05-01"),
      expect.anything(),
    );
  });
});
