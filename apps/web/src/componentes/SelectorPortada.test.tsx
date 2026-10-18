import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { PortadaTareaApi } from "../api";
import { estiloPortada } from "../portada";
import { SelectorPortada } from "./SelectorPortada";

function json(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function montarFetch(imagenes: unknown[] = []) {
  const peticiones: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      if (url === "/api/tareas/t1/archivos" && method === "GET") return json(imagenes);
      peticiones.push({
        url,
        method,
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : null,
      });
      return json({ ok: true });
    }),
  );
  return { peticiones };
}

function renderSelector(portada: PortadaTareaApi | null = null) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <SelectorPortada tareaId="t1" proyectoId="p1" portada={portada} />
    </QueryClientProvider>,
  );
  return cliente;
}

describe("SelectorPortada", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("elegir un color envía el PATCH con la portada", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: "Portada" }));
    await user.click(screen.getByRole("radio", { name: "Verde" }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1",
        method: "PATCH",
        body: { portada: { tipo: "color", valor: "#18794E" } },
      }),
    );
  });

  it("elegir un patrón envía su valor", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: "Portada" }));
    await user.click(screen.getByRole("radio", { name: "Rayas ámbar" }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1",
        method: "PATCH",
        body: { portada: { tipo: "color", valor: "rayas-ambar" } },
      }),
    );
  });

  it("quitar la portada envía null", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();
    renderSelector({ tipo: "color", valor: "#2563D9" });

    await user.click(screen.getByRole("button", { name: "Portada" }));
    await user.click(screen.getByRole("button", { name: "Quitar portada" }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1",
        method: "PATCH",
        body: { portada: null },
      }),
    );
  });

  it("ofrece las imágenes adjuntas y elige una como portada", async () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    const { peticiones } = montarFetch([
      { id: uuid, nombre: "foto.png", mime: "image/png", tamano: 10, createdAt: "" },
    ]);
    const user = userEvent.setup();
    renderSelector();

    await user.click(screen.getByRole("button", { name: "Portada" }));
    await user.click(await screen.findByRole("radio", { name: "foto.png" }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1",
        method: "PATCH",
        body: { portada: { tipo: "imagen", archivoId: uuid } },
      }),
    );
  });

  it("estiloPortada devuelve el color, el patrón y la imagen con uuid válido", () => {
    expect(estiloPortada({ tipo: "color", valor: "#2563D9" })).toEqual({ backgroundColor: "#2563D9" });

    const patron = estiloPortada({ tipo: "color", valor: "puntos-rosa" });
    expect(typeof patron?.backgroundImage).toBe("string");
    expect(patron?.backgroundImage).toContain("gradient");

    const uuid = "11111111-1111-1111-1111-111111111111";
    const imagen = estiloPortada({ tipo: "imagen", archivoId: uuid });
    expect(imagen?.backgroundImage).toBe(`url(/api/archivos/${uuid})`);
    expect(imagen?.backgroundSize).toBe("cover");

    // Un id que no es uuid no construye ninguna URL.
    expect(estiloPortada({ tipo: "imagen", archivoId: "a1" })).toBeNull();
    expect(estiloPortada(null)).toBeNull();
  });
});
