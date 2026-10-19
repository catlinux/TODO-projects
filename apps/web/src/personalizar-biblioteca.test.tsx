import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import { type ArchivoApi, type ProyectoApi } from "./api";
import { PersonalizarProyecto } from "./componentes/PersonalizarProyecto";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const BIBLIOTECA: ArchivoApi[] = [
  { id: UUID_A, nombre: "uno.png", mime: "image/png", tamano: 2048, createdAt: "" },
  { id: UUID_B, nombre: "dos.jpg", mime: "image/jpeg", tamano: 4096, createdAt: "" },
];

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

function renderizar(proyecto: ProyectoApi) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <PersonalizarProyecto proyecto={proyecto} abierto onCerrar={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("PersonalizarProyecto y la biblioteca", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("elige imágenes de la biblioteca y las guarda como fondo", async () => {
    let cuerpo: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === "/api/proyectos/p1/fondos") return json([]);
        if (url === "/api/biblioteca") return json(BIBLIOTECA);
        if (url === "/api/proyectos/p1" && method === "PATCH") {
          cuerpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return json({ id: "p1" });
        }
        return json({}, 404);
      }),
    );

    const user = userEvent.setup();
    renderizar(proyectoBase());

    const abrir = await screen.findByRole("button", { name: "Elegir de mi biblioteca" });
    await waitFor(() => expect(abrir).toHaveProperty("disabled", false));
    await user.click(abrir);
    await user.click(await screen.findByRole("button", { name: "uno.png" }));
    expect(screen.getByRole("button", { name: "uno.png" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Usar imágenes como fondo" }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpo).not.toBeNull());
    expect(cuerpo).toEqual({
      fondo: { tipo: "imagenes", ids: [UUID_A], intervaloSeg: 30 },
    });
  });

  it("«Elegir 7 al azar» pide las aleatorias y conserva el intervalo actual", async () => {
    let cuerpo: Record<string, unknown> | null = null;
    let aleatorias = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === "/api/proyectos/p1/fondos") return json([]);
        if (url === "/api/biblioteca") return json(BIBLIOTECA);
        if (url === "/api/biblioteca/aleatorias" && method === "POST") {
          aleatorias += 1;
          return json({ ids: [UUID_A, UUID_B] });
        }
        if (url === "/api/proyectos/p1" && method === "PATCH") {
          cuerpo = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return json({ id: "p1" });
        }
        return json({}, 404);
      }),
    );

    const user = userEvent.setup();
    renderizar(
      proyectoBase({
        fondo: { tipo: "imagenes", ids: [UUID_A], intervaloSeg: 90 },
      }),
    );

    const aleatorio = await screen.findByRole("button", { name: "Elegir 7 al azar" });
    await waitFor(() => expect(aleatorio).toHaveProperty("disabled", false));
    await user.click(aleatorio);
    await waitFor(() => expect(aleatorias).toBe(1));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => expect(cuerpo).not.toBeNull());
    expect(cuerpo).toEqual({
      fondo: { tipo: "imagenes", ids: [UUID_A, UUID_B], intervaloSeg: 90 },
    });
  });

  it("con la biblioteca vacía enlaza a Ajustes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/proyectos/p1/fondos") return json([]);
        if (url === "/api/biblioteca") return json([]);
        return json({}, 404);
      }),
    );

    renderizar(proyectoBase());

    const enlace = await screen.findByRole("link", { name: "Subir imágenes en Ajustes" });
    expect(enlace.getAttribute("href")).toBe("/ajustes");
    expect(screen.getByRole("button", { name: "Elegir 7 al azar" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
