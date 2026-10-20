import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import type { ChecklistItemApi } from "./api";
import { DialogoElementoChecklist } from "./componentes/DialogoElementoChecklist";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const elemento: ChecklistItemApi = {
  id: "e1",
  tareaId: "t1",
  texto: "Preparar informe",
  descripcion: "Incluir los datos del trimestre.",
  hecho: false,
  posicion: 0,
  createdAt: "",
};

function montarFetch(estadoPatch = 200) {
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url === "/api/tareas/t1/checklist" && method === "GET") return json([elemento]);
      if (url === "/api/checklist/e1" && method === "PATCH") {
        patches.push({ url, body });
        if (estadoPatch !== 200) return json({ mensaje: "No se pudo guardar" }, estadoPatch);
        return json({ ...elemento, ...body });
      }
      return json({ mensaje: "no encontrado" }, 404);
    }),
  );
  return { patches };
}

function montar(onCerrar = vi.fn()) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <DialogoElementoChecklist
        tareaId="t1"
        proyectoId="p1"
        elemento={elemento}
        onCerrar={onCerrar}
      />
    </QueryClientProvider>,
  );
  return { onCerrar, cliente };
}

describe("DialogoElementoChecklist", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("carga el texto y la descripción y los guarda con PATCH", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    const { onCerrar } = montar();

    const campo = (await screen.findByLabelText(/^descripción$/i)) as HTMLTextAreaElement;
    await waitFor(() => expect(campo.value).toBe("Incluir los datos del trimestre."));
    expect((screen.getByLabelText(/texto del elemento/i) as HTMLInputElement).value).toBe(
      "Preparar informe",
    );

    await user.clear(campo);
    await user.type(campo, "Revisar las cifras antes de enviarlo.");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() =>
      expect(patches).toContainEqual({
        url: "/api/checklist/e1",
        body: { texto: "Preparar informe", descripcion: "Revisar las cifras antes de enviarlo." },
      }),
    );
    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
  });

  it("vaciar la descripción la guarda como null", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    montar();

    const campo = (await screen.findByLabelText(/^descripción$/i)) as HTMLTextAreaElement;
    await waitFor(() => expect(campo.value).toBe("Incluir los datos del trimestre."));
    await user.clear(campo);
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() =>
      expect(patches).toContainEqual({
        url: "/api/checklist/e1",
        body: { texto: "Preparar informe", descripcion: null },
      }),
    );
  });

  it("Escape cierra sin guardar", async () => {
    const { patches } = montarFetch();
    const user = userEvent.setup();
    const { onCerrar } = montar();

    const campo = (await screen.findByLabelText(/^descripción$/i)) as HTMLTextAreaElement;
    await user.type(campo, " sin guardar");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
    expect(patches).toHaveLength(0);
  });

  it("muestra dentro del diálogo el error del servidor", async () => {
    montarFetch(400);
    const user = userEvent.setup();
    const { onCerrar } = montar();

    await screen.findByLabelText(/^descripción$/i);
    await waitFor(() =>
      expect((screen.getByLabelText(/^descripción$/i) as HTMLTextAreaElement).value).toBe(
        "Incluir los datos del trimestre.",
      ),
    );
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    expect((await screen.findByRole("alert")).textContent).toContain("No se pudo guardar");
    expect(onCerrar).not.toHaveBeenCalled();
  });
});
