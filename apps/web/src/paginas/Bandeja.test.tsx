import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { ColumnaApi, ProyectoApi, TareaApi } from "../api";
import App from "../App";
import Bandeja from "./Bandeja";

const proyectoBandeja: ProyectoApi = {
  id: "b1",
  nombre: "Bandeja de entrada",
  propietarioId: "u1",
  createdAt: "",
  updatedAt: "",
};

const columnaEntrada: ColumnaApi = {
  id: "ce",
  proyectoId: "b1",
  nombre: "Entrada",
  posicion: 0,
  createdAt: "",
  updatedAt: "",
};

const otrosProyectos: ProyectoApi[] = [
  { id: "p1", nombre: "Casa", propietarioId: "u1", createdAt: "", updatedAt: "" },
];

const columnasCasa: ColumnaApi[] = [
  { id: "c1", proyectoId: "p1", nombre: "Pendiente", posicion: 0, createdAt: "", updatedAt: "" },
  { id: "c2", proyectoId: "p1", nombre: "Hecho", posicion: 1, createdAt: "", updatedAt: "" },
];

function tarea(id: string, titulo: string, extra: Partial<TareaApi> = {}): TareaApi {
  return {
    id,
    proyectoId: "b1",
    columnaId: "ce",
    titulo,
    posicion: 0,
    venceEn: null,
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Llamada {
  url: string;
  method: string;
  body: unknown;
}

/** Stub de `fetch` con la bandeja, los proyectos y las mutaciones de la página. */
function simularFetch(tareasIniciales: TareaApi[] = [], fallaCrear = false) {
  let tareas = tareasIniciales;
  const llamadas: Llamada[] = [];

  const espia = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    llamadas.push({ url, method, body });

    if (url === "/api/bandeja") {
      return json({ proyecto: proyectoBandeja, columnas: [columnaEntrada], tareas });
    }
    if (url === "/api/proyectos") {
      return json(otrosProyectos);
    }
    if (url === "/api/proyectos/p1/columnas") {
      return json(columnasCasa);
    }
    if (url === "/api/proyectos/b1/tareas" && method === "POST") {
      if (fallaCrear) {
        return json({ mensaje: "No se pudo crear la tarea" }, 500);
      }
      const cuerpo = body as { titulo: string };
      const nueva = tarea(`n${tareas.length + 1}`, cuerpo.titulo);
      tareas = [...tareas, nueva];
      return json(nueva, 201);
    }
    if (url === "/api/tareas/t1/mover" && method === "POST") {
      tareas = tareas.filter((item) => item.id !== "t1");
      return json({});
    }
    if (url === "/api/tareas/t1" && method === "DELETE") {
      tareas = tareas.filter((item) => item.id !== "t1");
      return new Response(null, { status: 204 });
    }
    return json({}, 404);
  });

  vi.stubGlobal("fetch", espia);
  return { espia, llamadas, tareas: () => tareas };
}

function renderBandeja(tareasIniciales: TareaApi[] = [], fallaCrear = false) {
  const api = simularFetch(tareasIniciales, fallaCrear);
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={["/bandeja"]}>
        <Routes>
          <Route path="/bandeja" element={<Bandeja />} />
          <Route path="/proyectos/:id/tareas/:tareaId" element={<p>Tarjeta abierta</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...api, user };
}

describe("Bandeja", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("crea una tarea con Intro, vacía el campo y mantiene el foco", async () => {
    const { user, llamadas } = renderBandeja();

    const campo = await screen.findByLabelText(/añadir a la bandeja/i);
    await user.click(campo);
    await user.keyboard("Comprar pan{Enter}");

    expect(await screen.findByText("Comprar pan")).toBeTruthy();
    await waitFor(() => expect((campo as HTMLInputElement).value).toBe(""));
    expect(document.activeElement).toBe(campo);

    const creada = llamadas.find((llamada) => llamada.url === "/api/proyectos/b1/tareas");
    expect(creada?.body).toEqual({ titulo: "Comprar pan", columnaId: "ce" });
  });

  it("no crea tareas con el título vacío", async () => {
    const { user, llamadas } = renderBandeja();

    const campo = await screen.findByLabelText(/añadir a la bandeja/i);
    await user.type(campo, "   ");
    fireEvent.submit(campo.closest("form") as HTMLFormElement);

    expect(llamadas.some((llamada) => llamada.method === "POST")).toBe(false);
  });

  it("muestra las tareas de la bandeja con su fecha", async () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    renderBandeja([tarea("t1", "Pagar la renta", { venceEn: ayer.toISOString() })]);

    expect(await screen.findByText("Pagar la renta")).toBeTruthy();
    expect(await screen.findByText("Ayer")).toBeTruthy();
  });

  it("muestra un estado vacío amable", async () => {
    renderBandeja();

    expect(await screen.findByText(/la bandeja está vacía/i)).toBeTruthy();
  });

  it("abre la tarjeta al pulsar el título", async () => {
    const { user } = renderBandeja([tarea("t1", "Abrir esta")]);

    await user.click(await screen.findByRole("link", { name: "Abrir esta" }));

    expect(await screen.findByText("Tarjeta abierta")).toBeTruthy();
  });

  it("mueve la tarea al proyecto y columna elegidos y desaparece de la lista", async () => {
    const { user, llamadas } = renderBandeja([tarea("t1", "Mudar")]);

    await screen.findByText("Mudar");
    await user.click(screen.getByRole("button", { name: /mover a/i }));

    const dialogo = await screen.findByRole("dialog");
    const columna = within(dialogo).getByLabelText("Columna") as HTMLSelectElement;
    await waitFor(() => expect(columna.value).toBe("c1"));

    await user.selectOptions(columna, "c2");
    await user.click(within(dialogo).getByRole("button", { name: /^mover$/i }));

    await waitFor(() => {
      const llamada = llamadas.find((item) => item.url === "/api/tareas/t1/mover");
      expect(llamada?.body).toEqual({ proyectoId: "p1", columnaId: "c2" });
    });
    await waitFor(() => expect(screen.queryByText("Mudar")).toBeNull());
  });

  it("elimina una tarea tras confirmarlo", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { user, llamadas } = renderBandeja([tarea("t1", "Borrar esto")]);

    await screen.findByText("Borrar esto");
    await user.click(screen.getByRole("button", { name: /eliminar/i }));

    await waitFor(() =>
      expect(
        llamadas.some((llamada) => llamada.url === "/api/tareas/t1" && llamada.method === "DELETE"),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Borrar esto")).toBeNull());
  });

  it("muestra el error de la API si falla la creación", async () => {
    const { user } = renderBandeja([], true);

    const campo = await screen.findByLabelText(/añadir a la bandeja/i);
    await user.type(campo, "Falla{Enter}");

    expect(await screen.findByText("No se pudo crear la tarea")).toBeTruthy();
  });

  it("protege la ruta /bandeja y manda a iniciar sesión", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/yo") return json({ mensaje: "No autenticado" }, 500);
        if (url === "/api/auth/metodos") {
          return json({ correo: true, registro: false, pin: false, huella: false });
        }
        return json({}, 404);
      }),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter initialEntries={["/bandeja"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: /iniciar sesión/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /bandeja de entrada/i })).toBeNull();
  });
});
