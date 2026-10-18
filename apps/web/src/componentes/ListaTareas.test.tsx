import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import { type ColumnaApi, type EtiquetaApi, type TareaApi } from "../api";
import { ListaTareas } from "./ListaTareas";

const columnas: ColumnaApi[] = [
  { id: "c1", proyectoId: "p1", nombre: "Pendiente", posicion: 0, createdAt: "", updatedAt: "" },
  { id: "c2", proyectoId: "p1", nombre: "En curso", posicion: 1, createdAt: "", updatedAt: "" },
  { id: "c3", proyectoId: "p1", nombre: "Hecho", posicion: 2, createdAt: "", updatedAt: "" },
];

function tarea(
  parcial: Partial<TareaApi> & { id: string; columnaId: string; titulo: string },
): TareaApi {
  return { proyectoId: "p1", posicion: 0, createdAt: "", updatedAt: "", ...parcial };
}

function renderizar(
  tareas: TareaApi[],
  opciones?: { etiquetas?: EtiquetaApi[]; filtroActivo?: boolean; onNuevaTarea?: () => void },
): { onNuevaTarea: ReturnType<typeof vi.fn> } {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onNuevaTarea = vi.fn();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <ListaTareas
          proyectoId="p1"
          columnas={columnas}
          tareas={tareas}
          etiquetas={opciones?.etiquetas ?? []}
          filtroActivo={opciones?.filtroActivo ?? false}
          onNuevaTarea={opciones?.onNuevaTarea ?? onNuevaTarea}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onNuevaTarea };
}

/** Títulos de las filas en el orden en que se pintan. */
function titulosVisibles(): Array<string | null> {
  return Array.from(document.querySelectorAll(".lista-fila__titulo")).map((el) => el.textContent);
}

describe("ListaTareas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("agrupa por columna en orden de posición y pliega y despliega un grupo", async () => {
    const user = userEvent.setup();
    renderizar([
      tarea({ id: "t1", columnaId: "c1", titulo: "Beta", posicion: 1 }),
      tarea({ id: "t2", columnaId: "c1", titulo: "Alfa", posicion: 0 }),
      tarea({ id: "t3", columnaId: "c3", titulo: "Zeta" }),
    ]);

    const botones = screen.getAllByRole("button", { name: /pendiente|hecho/i });
    expect(botones).toHaveLength(2);
    expect(botones[0]?.textContent).toContain("Pendiente");
    expect(botones[1]?.textContent).toContain("Hecho");
    expect(titulosVisibles()).toEqual(["Alfa", "Beta", "Zeta"]);

    expect(botones[0]?.getAttribute("aria-expanded")).toBe("true");
    await user.click(botones[0]!);
    expect(
      screen.getByRole("button", { name: /pendiente/i }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText("Alfa")).toBeNull();
    expect(screen.getByText("Zeta")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /pendiente/i }));
    expect(screen.getByText("Alfa")).toBeTruthy();
  });

  it("ordena por posición, fecha (sin fecha al final) y título", async () => {
    const user = userEvent.setup();
    renderizar([
      tarea({ id: "t1", columnaId: "c1", titulo: "Sin fecha", posicion: 0 }),
      tarea({
        id: "t2",
        columnaId: "c1",
        titulo: "Tarde",
        posicion: 1,
        venceEn: "2026-06-01T10:00:00.000Z",
      }),
      tarea({
        id: "t3",
        columnaId: "c1",
        titulo: "Pronto",
        posicion: 2,
        venceEn: "2026-05-01T10:00:00.000Z",
      }),
    ]);

    expect(titulosVisibles()).toEqual(["Sin fecha", "Tarde", "Pronto"]);

    await user.selectOptions(screen.getByLabelText(/ordenar por/i), "fecha");
    expect(titulosVisibles()).toEqual(["Pronto", "Tarde", "Sin fecha"]);

    await user.selectOptions(screen.getByLabelText(/ordenar por/i), "titulo");
    expect(titulosVisibles()).toEqual(["Pronto", "Sin fecha", "Tarde"]);
  });

  it("la casilla mueve a la última y a la primera columna y no aparece en recurrentes", async () => {
    const cuerpos: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.startsWith("/api/tareas/") && method === "PATCH") {
          cuerpos.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
          return new Response(JSON.stringify({ id: url.split("/").pop() }), {
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

    const user = userEvent.setup();
    renderizar([
      tarea({ id: "t1", columnaId: "c1", titulo: "Pendiente", posicion: 0 }),
      tarea({ id: "t2", columnaId: "c3", titulo: "Terminada", posicion: 1 }),
      tarea({ id: "t3", columnaId: "c1", titulo: "Repetida", posicion: 2, recurrencia: "FREQ=DAILY" }),
    ]);

    expect(screen.queryByRole("checkbox", { name: /repetida/i })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /marcar como hecha pendiente/i }));
    await user.click(screen.getByRole("checkbox", { name: /marcar como pendiente terminada/i }));

    await waitFor(() => expect(cuerpos).toHaveLength(2));
    expect(cuerpos[0]).toMatchObject({ columnaId: "c3" });
    expect(cuerpos[1]).toMatchObject({ columnaId: "c1" });
  });

  it("oculta los grupos sin resultados y pinta las etiquetas de cada fila", () => {
    const etiquetas: EtiquetaApi[] = [
      { id: "e1", proyectoId: "p1", nombre: "Casa", color: "#6E4FE6", createdAt: "", updatedAt: "" },
    ];
    renderizar([tarea({ id: "t1", columnaId: "c1", titulo: "Con casa", etiquetas: ["e1"] })], {
      etiquetas,
    });

    expect(screen.getByText("Con casa")).toBeTruthy();
    expect(screen.getByText("Casa")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /en curso/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /hecho/i })).toBeNull();
  });

  it("muestra el estado vacío con un botón para crear la primera tarea", async () => {
    const user = userEvent.setup();
    const { onNuevaTarea } = renderizar([]);

    expect(screen.getByText(/aún no hay tareas/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /nueva tarea/i }));
    expect(onNuevaTarea).toHaveBeenCalledTimes(1);
  });

  it("con filtro activo, el estado vacío habla del filtro", () => {
    renderizar([], { filtroActivo: true });
    expect(screen.getByText(/ninguna tarea coincide con el filtro/i)).toBeTruthy();
  });
});
