import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { EtiquetaApi } from "../api";
import { SelectorEtiquetas } from "./SelectorEtiquetas";

const etiquetasBase: EtiquetaApi[] = [
  { id: "e1", proyectoId: "p1", nombre: "Casa", color: "#6E4FE6", createdAt: "", updatedAt: "" },
  { id: "e2", proyectoId: "p1", nombre: "Urgente", color: "#C8303A", createdAt: "", updatedAt: "" },
];

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface OpcionesFetch {
  etiquetas?: EtiquetaApi[];
  respuestaCrear?: () => Response;
}

function montarFetch({ etiquetas = etiquetasBase, respuestaCrear }: OpcionesFetch = {}) {
  const puts: Array<Record<string, unknown>> = [];
  const posts: Array<Record<string, unknown>> = [];
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url === "/api/proyectos/p1/etiquetas" && method === "GET") return json(etiquetas);
      if (url === "/api/proyectos/p1/etiquetas" && method === "POST") {
        posts.push(body);
        if (respuestaCrear) return respuestaCrear();
        return json({ id: "e3", proyectoId: "p1", ...body, createdAt: "", updatedAt: "" }, 201);
      }
      if (url === "/api/tareas/t1/etiquetas" && method === "PUT") {
        puts.push(body);
        return json({ ok: true });
      }
      if (url.startsWith("/api/etiquetas/") && method === "PATCH") {
        patches.push({ url, body });
        return json({ id: url.split("/").pop() });
      }
      if (url.startsWith("/api/etiquetas/") && method === "DELETE") {
        deletes.push(url.split("/").pop() ?? "");
        return new Response(null, { status: 204 });
      }
      return json({ mensaje: "no encontrado" }, 404);
    }),
  );

  return { puts, posts, patches, deletes };
}

function renderSelector(asignadas: string[] = []) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <SelectorEtiquetas tareaId="t1" proyectoId="p1" asignadas={asignadas} />
    </QueryClientProvider>,
  );
  return cliente;
}

async function abrirPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Etiquetas" }));
  return screen.findByRole("dialog", { name: "Etiquetas" });
}

describe("SelectorEtiquetas", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("asignar una etiqueta envía el PUT con el conjunto completo", async () => {
    const { puts } = montarFetch();
    const user = userEvent.setup();
    renderSelector(["e1"]);

    await abrirPanel(user);
    await user.click(screen.getByRole("checkbox", { name: "Urgente" }));

    await waitFor(() => expect(puts).toContainEqual({ ids: ["e1", "e2"] }));
  });

  it("quitar una etiqueta envía el PUT sin ella", async () => {
    const { puts } = montarFetch();
    const user = userEvent.setup();
    renderSelector(["e1", "e2"]);

    await abrirPanel(user);
    await user.click(screen.getByRole("checkbox", { name: "Casa" }));

    await waitFor(() => expect(puts).toContainEqual({ ids: ["e2"] }));
  });

  it("crea una etiqueta a partir del texto buscado", async () => {
    const { posts } = montarFetch();
    const user = userEvent.setup();
    renderSelector();

    await abrirPanel(user);
    await user.type(screen.getByRole("searchbox", { name: /buscar etiqueta/i }), "Nueva");

    const sugerencia = await screen.findByRole("button", { name: "Crear «Nueva»" });
    await user.click(sugerencia);
    await user.click(screen.getByRole("button", { name: /crear etiqueta/i }));

    await waitFor(() =>
      expect(posts).toContainEqual({ nombre: "Nueva", color: "#6E4FE6" }),
    );
  });

  it("muestra el error 409 al repetir un nombre", async () => {
    montarFetch({
      respuestaCrear: () => json({ mensaje: "Ya existe una etiqueta con ese nombre" }, 409),
    });
    const user = userEvent.setup();
    renderSelector();

    await abrirPanel(user);
    await user.type(screen.getByLabelText(/nombre de la etiqueta/i), "Casa");
    await user.click(screen.getByRole("button", { name: /crear etiqueta/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(await screen.findByText(/ya existe una etiqueta con ese nombre/i)).toBeTruthy();
  });

  it("la búsqueda filtra la lista", async () => {
    montarFetch();
    const user = userEvent.setup();
    renderSelector();

    await abrirPanel(user);
    expect(screen.getByRole("checkbox", { name: "Casa" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Urgente" })).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: /buscar etiqueta/i }), "urg");

    expect(screen.queryByRole("checkbox", { name: "Casa" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Urgente" })).toBeTruthy();
  });

  it("renombra, cambia el color y borra con confirmación", async () => {
    const { patches, deletes } = montarFetch();
    const user = userEvent.setup();
    renderSelector();

    await abrirPanel(user);

    await user.click(screen.getByRole("button", { name: /editar etiqueta: casa/i }));
    const nombre = screen.getByLabelText(/nuevo nombre/i);
    await user.clear(nombre);
    await user.type(nombre, "Hogar");
    await user.click(screen.getAllByRole("radio", { name: "Turquesa" })[0]!);
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() =>
      expect(patches).toContainEqual({
        url: "/api/etiquetas/e1",
        body: { nombre: "Hogar", color: "#0E7490" },
      }),
    );

    await user.click(screen.getByRole("button", { name: /eliminar etiqueta: urgente/i }));
    expect(await screen.findByText(/¿eliminar la etiqueta «urgente»\?/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^eliminar$/i }));

    await waitFor(() => expect(deletes).toContain("e2"));
  });

  it("Escape cierra el panel y devuelve el foco al botón", async () => {
    montarFetch();
    const user = userEvent.setup();
    renderSelector();

    const boton = await screen.findByRole("button", { name: "Etiquetas" });
    const panel = await abrirPanel(user);
    await user.type(screen.getByRole("searchbox", { name: /buscar etiqueta/i }), "{Escape}");

    expect(panel.isConnected).toBe(false);
    expect(document.activeElement).toBe(boton);
  });
});
