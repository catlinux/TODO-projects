import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");
  return {
    default: (props: {
      datesSet?: (info: { startStr: string; endStr: string }) => void;
      events?: unknown[];
    }) => {
      React.useEffect(() => {
        props.datesSet?.({
          startStr: "2026-05-01T00:00:00.000Z",
          endStr: "2026-06-01T00:00:00.000Z",
        });
      }, []);
      return React.createElement(
        "div",
        { "data-testid": "calendario" },
        `${props.events?.length ?? 0} eventos`,
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

  it("agrupa las ocurrencias por día en la vista Lista", async () => {
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

    renderAgenda();

    expect(await screen.findByText(/10 de mayo/i)).toBeTruthy();
    expect(await screen.findByText(/Reunión/)).toBeTruthy();
    expect(await screen.findByText(/Demostración/)).toBeTruthy();

    const enlace = screen.getByRole("link", { name: /Reunión/ });
    expect(enlace.getAttribute("href")).toBe("/proyectos/p1");

    const descarga = screen.getByRole("link", { name: /descargar calendario/i });
    expect(descarga.getAttribute("href")).toBe("/api/agenda.ics");
  });

  it("carga el calendario con el rango visible", async () => {
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
    expect(await screen.findByText("2 eventos")).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      expect.stringContaining("/api/agenda?desde=2026-05-01"),
      expect.anything(),
    );
  });
});
