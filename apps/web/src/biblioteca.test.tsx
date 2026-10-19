import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import type { ArchivoApi } from "./api";
import { BibliotecaImagenes } from "./componentes/BibliotecaImagenes";

const UUID = "11111111-1111-4111-8111-111111111111";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function archivo(id: string, nombre: string, tamano = 2048): ArchivoApi {
  return { id, nombre, mime: "image/png", tamano, createdAt: "" };
}

function renderizar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <BibliotecaImagenes />
    </QueryClientProvider>,
  );
  return cliente;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

describe("BibliotecaImagenes", () => {
  beforeEach(() => {
    // Sin soporte de mapa de bits, reducirImagen devuelve el original al instante.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("sin canvas");
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("muestra el contador y el estado vacío con la pista de 7 al azar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));

    renderizar();

    expect(await screen.findByText("0 de 300 imágenes")).toBeTruthy();
    expect(await screen.findByText(/7 imágenes al azar/i)).toBeTruthy();
  });

  it("sube con una cola de 3 y muestra el error de un archivo sin parar el resto", async () => {
    let lista: ArchivoApi[] = [];
    let activos = 0;
    let maxActivos = 0;
    const subidas: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === "/api/biblioteca" && method === "GET") return json(lista);
        if (url === "/api/biblioteca" && method === "POST") {
          const datos = init?.body as FormData;
          const fichero = datos.get("archivo") as File;
          subidas.push(fichero.name);
          activos += 1;
          maxActivos = Math.max(maxActivos, activos);
          await esperar(15);
          activos -= 1;
          if (fichero.name === "falla.png") {
            return json({ mensaje: "No se pudo guardar" }, 500);
          }
          const creado = archivo(
            `${String(subidas.length).padStart(8, "0")}-1111-4111-8111-111111111111`,
            fichero.name,
          );
          lista = [creado, ...lista];
          return json(creado, 201);
        }
        return json({}, 404);
      }),
    );

    const user = userEvent.setup();
    renderizar();
    await screen.findByText("0 de 300 imágenes");

    await user.upload(screen.getByLabelText("Subir imágenes"), [
      new File(["a"], "uno.png", { type: "image/png" }),
      new File(["b"], "dos.png", { type: "image/png" }),
      new File(["c"], "tres.png", { type: "image/png" }),
      new File(["d"], "falla.png", { type: "image/png" }),
    ]);

    expect(await screen.findByText("4 de 4")).toBeTruthy();
    expect(subidas).toHaveLength(4);
    expect(maxActivos).toBeLessThanOrEqual(3);
    expect(maxActivos).toBeGreaterThan(1);
    expect(screen.getByText("«falla.png»: No se pudo guardar")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("3 de 300 imágenes")).toBeTruthy());
  });

  it("rechaza por archivo el tipo no válido, el tamaño y el límite de 300", async () => {
    const lleno = Array.from({ length: 299 }, (_, indice) =>
      archivo(`id-${indice}`, `imagen-${indice}.png`),
    );
    let lista = lleno;
    let subidas = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === "/api/biblioteca" && method === "GET") return json(lista);
        if (url === "/api/biblioteca" && method === "POST") {
          subidas += 1;
          lista = [...lista, archivo(UUID, "valida.png")];
          return json(archivo(UUID, "valida.png"), 201);
        }
        return json({}, 404);
      }),
    );

    const grande = new File(["x"], "grande.png", { type: "image/png" });
    Object.defineProperty(grande, "size", { value: 11 * 1024 * 1024 });

    const user = userEvent.setup({ applyAccept: false });
    renderizar();
    await screen.findByText("299 de 300 imágenes");

    await user.upload(
      screen.getByLabelText("Subir imágenes"),
      [
        new File(["x"], "notas.txt", { type: "text/plain" }),
        grande,
        new File(["x"], "valida.png", { type: "image/png" }),
        new File(["x"], "otra.png", { type: "image/png" }),
      ],
    );

    expect(await screen.findByText("4 de 4", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/«notas.txt» no es una imagen válida/i)).toBeTruthy();
    expect(screen.getByText(/«grande.png» supera los 10 MB/i)).toBeTruthy();
    expect(screen.getByText(/«otra.png» no se ha subido/i)).toBeTruthy();
    expect(subidas).toBe(1);
  });

  it("elimina una imagen tras confirmar, avisando de los fondos de proyectos", async () => {
    let lista = [archivo(UUID, "foto.png")];
    const confirmar = vi.fn<(mensaje?: string) => boolean>(() => true);
    let borrada: string | null = null;
    vi.stubGlobal("confirm", confirmar);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === "/api/biblioteca" && method === "GET") return json(lista);
        if (url.startsWith("/api/biblioteca/") && method === "DELETE") {
          borrada = url.slice("/api/biblioteca/".length);
          lista = lista.filter((imagen) => imagen.id !== borrada);
          return new Response(null, { status: 204 });
        }
        return json({}, 404);
      }),
    );

    const user = userEvent.setup();
    renderizar();
    expect(await screen.findByText("foto.png")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Eliminar «foto.png»" }));

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(String(confirmar.mock.calls[0]?.[0])).toMatch(/fondos de los proyectos/i);
    await waitFor(() => expect(borrada).toBe(UUID));
    expect(await screen.findByText("La biblioteca está vacía.")).toBeTruthy();
    expect(screen.getByText("0 de 300 imágenes")).toBeTruthy();
  });
});
