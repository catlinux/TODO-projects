import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@fullcalendar/react", async () => {
  const React = await import("react");
  return {
    default: (props: {
      datesSet?: (info: { startStr: string; endStr: string }) => void;
      navLinkDayClick?: (fecha: Date) => void;
      events?: Array<{ classNames?: string[] }>;
      dayMaxEvents?: number;
      moreLinkText?: string;
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
        React.Fragment,
        null,
        React.createElement(
          "div",
          {
            "data-testid": "calendario",
            "data-day-max": String(props.dayMaxEvents),
            "data-more": String(props.moreLinkText ?? ""),
          },
          `${eventos.length} eventos (${hechas} hechas)`,
        ),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => props.navLinkDayClick?.(new Date(2026, 4, 10, 12)),
          },
          "Elegir 10 de mayo",
        ),
      );
    },
  };
});

import "./i18n/index";
import Agenda from "./paginas/Agenda";

interface OcurrenciaPrueba {
  tareaId: string;
  titulo: string;
  proyectoId: string;
  proyectoNombre: string;
  columnaId: string;
  columnaNombre: string;
  fecha: string;
  esRecurrente: boolean;
  hecha: boolean;
  recordatorioMin: number | null;
}

const ocurrencias: OcurrenciaPrueba[] = [
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
    recordatorioMin: null,
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
    recordatorioMin: null,
  },
];

function respuestaJson(datos: unknown): Response {
  return new Response(JSON.stringify(datos), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

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
          return respuestaJson(ocurrencias);
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAgenda();
    await user.click(screen.getByRole("button", { name: /^lista$/i }));

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
          return respuestaJson(ocurrencias);
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

  it("limita a dos eventos por día y muestra el panel del día seleccionado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/proyectos") {
          return respuestaJson([
            {
              id: "p1",
              nombre: "Proyecto",
              propietarioId: "u1",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]);
        }
        if (url.startsWith("/api/agenda?")) {
          return respuestaJson(ocurrencias);
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { user } = renderAgenda();
    await user.click(screen.getByRole("button", { name: /calendario/i }));

    const calendario = await screen.findByTestId("calendario");
    expect(calendario.getAttribute("data-day-max")).toBe("2");
    expect(calendario.getAttribute("data-more")).toBe("más");

    await user.click(screen.getByRole("button", { name: "Elegir 10 de mayo" }));

    const panel = await screen.findByRole("region", { name: /10 de mayo/i });
    expect(within(panel).getByText("Reunión")).toBeTruthy();
    expect(within(panel).getByText("Demostración")).toBeTruthy();
  });

  it("lista los próximos avisos con hora, proyecto y antelación", async () => {
    const ahora = Date.now();
    const conAvisos: OcurrenciaPrueba[] = [
      {
        ...ocurrencias[1]!,
        tareaId: "t2",
        titulo: "Demostración",
        fecha: new Date(ahora + 2 * 24 * 60 * 60 * 1000).toISOString(),
        recordatorioMin: 1440,
      },
      {
        ...ocurrencias[0]!,
        tareaId: "t1",
        titulo: "Reunión",
        fecha: new Date(ahora + 60 * 60 * 1000).toISOString(),
        hecha: false,
        recordatorioMin: 5,
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/proyectos") {
          return respuestaJson([
            {
              id: "p1",
              nombre: "Proyecto",
              propietarioId: "u1",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]);
        }
        if (url.startsWith("/api/agenda?")) {
          return respuestaJson(conAvisos);
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderAgenda();

    const aside = await screen.findByRole("complementary", { name: /próximos avisos/i });
    const enlaces = await within(aside).findAllByRole("link");
    expect(enlaces.map((enlace) => enlace.textContent)).toEqual(["Reunión", "Demostración"]);
    expect(await within(aside).findByText("5 minutos antes")).toBeTruthy();
    expect(within(aside).getByText("1 día antes")).toBeTruthy();
    expect(within(aside).getAllByText("Proyecto")).toHaveLength(2);
    expect(aside.querySelectorAll(".aviso__color")).toHaveLength(2);

    const hora = aside.querySelector(".aviso__hora.cifra");
    expect(hora?.textContent).toMatch(/\d{2}:\d{2}/);
    expect(within(aside).queryByText(/no hay avisos/i)).toBeNull();
  });

  it("avisa cuando no hay avisos en los próximos 7 días", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/agenda?")) {
          return respuestaJson(ocurrencias);
        }
        return new Response(JSON.stringify({}), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderAgenda();

    const aside = await screen.findByRole("complementary", { name: /próximos avisos/i });
    expect(
      await within(aside).findByText("No hay avisos en los próximos 7 días"),
    ).toBeTruthy();
  });
});
