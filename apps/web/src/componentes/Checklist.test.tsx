import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { ChecklistItemApi } from "../api";
import { Checklist } from "./Checklist";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const itemsBase: ChecklistItemApi[] = [
  { id: "i1", tareaId: "t1", texto: "Comprar leche", hecho: true, posicion: 0, createdAt: "" },
  { id: "i2", tareaId: "t1", texto: "Llamar al fontanero", hecho: false, posicion: 1, createdAt: "" },
];

function montarFetch(items = itemsBase) {
  const posts: Array<Record<string, unknown>> = [];
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url === "/api/tareas/t1/checklist" && method === "GET") return json(items);
      if (url === "/api/tareas/t1/checklist" && method === "POST") {
        posts.push(body);
        return json({ id: "i3", tareaId: "t1", hecho: false, posicion: 2, ...body }, 201);
      }
      if (url.startsWith("/api/checklist/") && method === "PATCH") {
        patches.push({ url, body });
        return json({ id: url.split("/").pop() });
      }
      if (url.startsWith("/api/checklist/") && method === "DELETE") {
        deletes.push(url.split("/").pop() ?? "");
        return new Response(null, { status: 204 });
      }
      return json({ mensaje: "no encontrado" }, 404);
    }),
  );

  return { posts, patches, deletes };
}

function renderChecklist() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <Checklist tareaId="t1" proyectoId="p1" />
    </QueryClientProvider>,
  );
  return cliente;
}

describe("Checklist", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra el progreso con la barra y la cuenta n/m", async () => {
    montarFetch();
    renderChecklist();

    const barra = await screen.findByRole("progressbar", { name: /progreso del checklist/i });
    await screen.findByText("1/2");
    expect(barra.getAttribute("aria-valuenow")).toBe("1");
    expect(barra.getAttribute("aria-valuemax")).toBe("2");
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("añade con Intro y mantiene el foco en el campo", async () => {
    const { posts } = montarFetch();
    const user = userEvent.setup();
    renderChecklist();

    const campo = await screen.findByLabelText(/añadir elemento/i);
    await user.type(campo, "Regar plantas{Enter}");

    await waitFor(() => expect(posts).toContainEqual({ texto: "Regar plantas" }));
    await waitFor(() => expect((campo as HTMLInputElement).value).toBe(""));
    expect(document.activeElement).toBe(campo);
  });

  it("marca un elemento y lo borra", async () => {
    const { patches, deletes } = montarFetch();
    const user = userEvent.setup();
    renderChecklist();

    await user.click(await screen.findByRole("checkbox", { name: /llamar al fontanero/i }));
    await waitFor(() =>
      expect(patches).toContainEqual({
        url: "/api/checklist/i2",
        body: { hecho: true },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Eliminar «Comprar leche»" }));
    await waitFor(() => expect(deletes).toContain("i1"));
  });

  it("reordena con los botones subir y bajar", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderChecklist();

    const bajar = await screen.findByRole("button", { name: "Bajar «Comprar leche»" });
    expect((bajar as HTMLButtonElement).disabled).toBe(false);
    await user.click(bajar);

    await waitFor(() =>
      expect(patches).toContainEqual({ url: "/api/checklist/i1", body: { posicion: 1 } }),
    );

    const subir = screen.getByRole("button", { name: "Subir «Llamar al fontanero»" });
    expect((subir as HTMLButtonElement).disabled).toBe(false);
    await user.click(subir);
    await waitFor(() =>
      expect(patches).toContainEqual({ url: "/api/checklist/i2", body: { posicion: 0 } }),
    );
  });

  it("oculta y muestra los elementos hechos sin tocar los datos", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderChecklist();

    expect(await screen.findByText("Comprar leche")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /ocultar hechos/i }));

    expect(screen.queryByText("Comprar leche")).toBeNull();
    expect(screen.getByText("Llamar al fontanero")).toBeTruthy();
    expect(patches).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /mostrar hechos/i }));
    expect(await screen.findByText("Comprar leche")).toBeTruthy();
  });

  it("edita el texto en línea", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    renderChecklist();

    await user.click(await screen.findByRole("button", { name: "Llamar al fontanero" }));
    const area = screen.getByLabelText(/texto del elemento/i);
    await user.clear(area);
    await user.type(area, "Llamar al electricista{Enter}");

    await waitFor(() =>
      expect(patches).toContainEqual({
        url: "/api/checklist/i2",
        body: { texto: "Llamar al electricista" },
      }),
    );
  });
});
