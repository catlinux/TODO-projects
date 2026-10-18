import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type {
  ElementoActividadApi,
  ElementoComentarioApi,
  ElementoHistorialApi,
  RespuestaActividadApi,
  UsuarioApi,
} from "../api";
import { PanelActividad } from "./PanelActividad";

const yo: UsuarioApi = { id: "u1", email: "ana@ejemplo.com", nombre: "Ana" };

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function comentario(extra: Partial<ElementoComentarioApi> & { id: string }): ElementoComentarioApi {
  return {
    tipo: "comentario",
    usuarioId: "u1",
    usuarioNombre: "Ana",
    creadoEn: "2026-10-18T08:30:00.000Z",
    texto: "Comentario",
    ...extra,
  };
}

function historial(
  extra: Partial<ElementoHistorialApi> & { id: string; historialTipo: string },
): ElementoHistorialApi {
  return {
    tipo: "historial",
    usuarioId: "u2",
    usuarioNombre: "Luis",
    creadoEn: "2026-10-18T08:00:00.000Z",
    ...extra,
  };
}

function montarFetch(paginas: Record<number, RespuestaActividadApi>) {
  const peticiones: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      peticiones.push({
        url,
        method,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
      });
      if (url.startsWith("/api/tareas/t1/actividad")) {
        const pagina = Number(new URL(url, "http://local").searchParams.get("pagina") ?? "1");
        return json(paginas[pagina] ?? { elementos: [], hayMas: false });
      }
      return json({ ok: true });
    }),
  );
  return { peticiones };
}

function renderPanel() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(["yo"], yo);
  render(
    <QueryClientProvider client={cliente}>
      <PanelActividad tareaId="t1" proyectoId="p1" />
    </QueryClientProvider>,
  );
  return cliente;
}

describe("PanelActividad", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("envía el comentario con Ctrl+Intro", async () => {
    const { peticiones } = montarFetch({ 1: { elementos: [], hayMas: false } });
    const user = userEvent.setup();
    renderPanel();

    const campo = await screen.findByLabelText(/escribe un comentario/i);
    await user.type(campo, "Hola equipo");
    await user.type(campo, "{Control>}{Enter}{/Control}");

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1/comentarios",
        method: "POST",
        body: { texto: "Hola equipo" },
      }),
    );
  });

  it("no envía un comentario vacío", async () => {
    const { peticiones } = montarFetch({ 1: { elementos: [], hayMas: false } });
    const user = userEvent.setup();
    renderPanel();

    const campo = await screen.findByLabelText(/escribe un comentario/i);
    const boton = screen.getByRole("button", { name: "Comentar" });
    expect((boton as HTMLButtonElement).disabled).toBe(true);

    await user.type(campo, "   ");
    await user.type(campo, "{Control>}{Enter}{/Control}");

    expect(peticiones.some((peticion) => peticion.url === "/api/tareas/t1/comentarios")).toBe(false);
    expect((boton as HTMLButtonElement).disabled).toBe(true);
  });

  it("solo permite editar y borrar los comentarios propios", async () => {
    const { peticiones } = montarFetch({
      1: {
        elementos: [
          comentario({ id: "k1", texto: "Mío" }),
          comentario({ id: "k2", usuarioId: "u2", usuarioNombre: "Luis", texto: "Ajeno" }),
        ],
        hayMas: false,
      },
    });
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("Mío");
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Borrar" })).toHaveLength(1);

    const ajeno = screen.getByText("Ajeno").closest("li") as HTMLElement;
    expect(ajeno.querySelectorAll("button")).toHaveLength(0);

    // Editar el propio envía el PATCH.
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const area = screen.getByLabelText(/editar comentario/i);
    await user.clear(area);
    await user.type(area, "Mío editado");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/comentarios/k1",
        method: "PATCH",
        body: { texto: "Mío editado" },
      }),
    );

    // Borrar pide confirmación antes del DELETE.
    await user.click(await screen.findByRole("button", { name: "Borrar" }));
    expect(screen.getByText(/borrar este comentario/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Borrar" }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/comentarios/k1",
        method: "DELETE",
        body: null,
      }),
    );
  });

  it("redacta el historial por tipo y tolera tipos desconocidos", async () => {
    const elementos: ElementoActividadApi[] = [
      historial({ id: "h1", historialTipo: "movida", desde: "Pendiente", hasta: "En curso" }),
      historial({ id: "h2", historialTipo: "fecha" }),
      historial({ id: "h3", historialTipo: "etiqueta", accion: "añadida", nombre: "Casa" }),
      historial({ id: "h4", historialTipo: "tipo-que-no-existe" }),
    ];
    montarFetch({ 1: { elementos, hayMas: false } });
    renderPanel();

    expect(await screen.findByText(/movió la tarjeta de Pendiente a En curso/i)).toBeTruthy();
    expect(screen.getByText(/cambió la fecha/i)).toBeTruthy();
    expect(screen.getByText(/añadió la etiqueta Casa/i)).toBeTruthy();
    expect(screen.getByText(/hizo un cambio/i)).toBeTruthy();
  });

  it("carga la página siguiente con «Cargar más»", async () => {
    const { peticiones } = montarFetch({
      1: { elementos: [comentario({ id: "k1", texto: "Primero" })], hayMas: true },
      2: { elementos: [comentario({ id: "k2", texto: "Anterior" })], hayMas: false },
    });
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText("Primero");
    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    expect(await screen.findByText("Anterior")).toBeTruthy();
    await waitFor(() =>
      expect(peticiones.some((peticion) => peticion.url.includes("pagina=2"))).toBe(true),
    );
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });
});
