import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import { type ProyectoApi } from "../api";
import { PersonalizarProyecto } from "./PersonalizarProyecto";

function proyectoBase(extra: Partial<ProyectoApi> = {}): ProyectoApi {
  return {
    id: "p1",
    nombre: "Proyecto",
    propietarioId: "u1",
    color: null,
    fondo: { tipo: "ambiente", ambiente: "bosque" },
    createdAt: "",
    updatedAt: "",
    ...extra,
  };
}

function renderizar(proyecto: ProyectoApi, onCerrar = vi.fn()) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <PersonalizarProyecto proyecto={proyecto} abierto onCerrar={onCerrar} />
    </QueryClientProvider>,
  );
  return { onCerrar };
}

describe("PersonalizarProyecto", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("muestra los valores actuales al abrir", async () => {
    vi.stubGlobal("fetch", vi.fn());

    renderizar(
      proyectoBase({
        nombre: "Casa",
        color: "#2f8f62",
        fondo: { tipo: "ambiente", ambiente: "noche" },
      }),
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText(/^nombre$/i) as HTMLInputElement).value).toBe("Casa");
    expect(screen.getByRole("button", { name: "Color del proyecto #2f8f62" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Noche" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("envía el PATCH con solo los campos cambiados", async () => {
    let cuerpo: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/proyectos/p1" && (init?.method ?? "GET") === "PATCH") {
          cuerpo = JSON.parse(String(init?.body ?? "{}"));
          return new Response(JSON.stringify({ id: "p1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );

    const { onCerrar } = renderizar(proyectoBase());
    const user = userEvent.setup();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Coral" }));
    await user.click(screen.getByRole("button", { name: "Color del proyecto #7a56c2" }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpo).not.toBeNull());
    expect(cuerpo).toEqual({
      color: "#7a56c2",
      fondo: { tipo: "ambiente", ambiente: "coral" },
    });
    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
  });

  it("«Automático» envía color:null", async () => {
    let cuerpo: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/proyectos/p1" && (init?.method ?? "GET") === "PATCH") {
          cuerpo = JSON.parse(String(init?.body ?? "{}"));
          return new Response(JSON.stringify({ id: "p1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }),
    );

    renderizar(proyectoBase({ color: "#2f4bc4" }));
    const user = userEvent.setup();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /automático/i }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpo).not.toBeNull());
    expect(cuerpo).toEqual({ color: null });
  });

  it("deshabilita la sección Imágenes con «Próximamente»", async () => {
    vi.stubGlobal("fetch", vi.fn());

    renderizar(proyectoBase());
    await screen.findByRole("dialog");

    const proximamente = screen.getByText("Próximamente");
    expect(proximamente).toBeTruthy();
    const grupo = screen.getByText("Imágenes").closest("fieldset");
    expect(grupo).not.toBeNull();
    expect((grupo as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("muestra el error de la API si falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ mensaje: "No se pudo guardar" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    renderizar(proyectoBase());
    const user = userEvent.setup();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Coral" }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(await screen.findByText("No se pudo guardar")).toBeTruthy();
  });
});
