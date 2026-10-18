import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import type { ArchivoApi, PortadaTareaApi } from "../api";
import { Adjuntos, formatearTamano } from "./Adjuntos";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

const imagen: ArchivoApi = {
  id: UUID,
  nombre: "foto.png",
  mime: "image/png",
  tamano: 2048,
  createdAt: "",
};

const documento: ArchivoApi = {
  id: UUID2,
  nombre: "informe.pdf",
  mime: "application/octet-stream",
  tamano: 3 * 1024 * 1024,
  createdAt: "",
};

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Peticion {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string> | undefined;
}

function montarFetch(inicial: ArchivoApi[] = [], estadoSubida = 201) {
  const peticiones: Peticion[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      if (url === "/api/tareas/t1/archivos" && method === "GET") return json(inicial);

      peticiones.push({
        url,
        method,
        body:
          typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : (init?.body ?? null),
        headers: init?.headers as Record<string, string> | undefined,
      });

      if (url === "/api/tareas/t1/archivos" && method === "POST") {
        if (estadoSubida !== 201) {
          return json({ mensaje: "El archivo supera el tamaño máximo" }, estadoSubida);
        }
        return json(
          { id: UUID, nombre: "foto.png", mime: "image/png", tamano: 4, createdAt: "" },
          201,
        );
      }
      return json({ ok: true });
    }),
  );
  return { peticiones };
}

function renderAdjuntos(portada: PortadaTareaApi | null = null) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <Adjuntos tareaId="t1" proyectoId="p1" portada={portada} />
    </QueryClientProvider>,
  );
  return cliente;
}

function archivoGrande(): File {
  const fichero = new File(["x"], "grande.png", { type: "image/png" });
  Object.defineProperty(fichero, "size", { value: 11 * 1024 * 1024 });
  return fichero;
}

describe("Adjuntos", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sube el archivo como multipart con el campo «archivo»", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();
    renderAdjuntos();

    const entrada = screen.getByLabelText("Elegir archivo");
    await user.upload(entrada, new File(["hola"], "foto.png", { type: "image/png" }));

    await waitFor(() => expect(peticiones).toHaveLength(1));
    const subida = peticiones[0]!;
    expect(subida.url).toBe("/api/tareas/t1/archivos");
    expect(subida.method).toBe("POST");
    expect(subida.body).toBeInstanceOf(FormData);
    const datos = subida.body as FormData;
    expect(datos.get("archivo")).toBeInstanceOf(File);
    // El navegador pone el Content-Type con el boundary: no se fija a mano.
    expect(subida.headers?.["Content-Type"]).toBeUndefined();
  });

  it("muestra el mensaje al recibir un 413", async () => {
    montarFetch([], 413);
    const user = userEvent.setup();
    renderAdjuntos();

    await user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File(["hola"], "foto.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "El archivo es demasiado grande",
    );
  });

  it("rechaza sin petición un archivo mayor de 10 MB", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();
    renderAdjuntos();

    await user.upload(screen.getByLabelText("Elegir archivo"), archivoGrande());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "El archivo es demasiado grande",
    );
    expect(peticiones).toHaveLength(0);
  });

  it("lista los adjuntos con miniatura, tamaño legible y enlace", async () => {
    montarFetch([imagen, documento]);
    renderAdjuntos();

    const miniatura = await screen.findByRole("img", { name: "foto.png" });
    expect(miniatura.getAttribute("src")).toBe(`/api/archivos/${UUID}`);
    expect(miniatura.getAttribute("loading")).toBe("lazy");

    expect(screen.getByText("2 KB")).toBeTruthy();
    expect(screen.getByText("3.0 MB")).toBeTruthy();

    const enlace = screen.getByRole("link", { name: /abrir foto\.png/i });
    expect(enlace.getAttribute("href")).toBe(`/api/archivos/${UUID}`);
    expect(enlace.getAttribute("target")).toBe("_blank");
    expect(enlace.getAttribute("rel")).toContain("noopener");

    const descarga = screen.getByRole("link", { name: /descargar informe\.pdf/i });
    expect(descarga.getAttribute("href")).toBe(`/api/archivos/${UUID2}`);
  });

  it("borra con confirmación", async () => {
    const { peticiones } = montarFetch([imagen]);
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    const user = userEvent.setup();
    renderAdjuntos();

    await user.click(await screen.findByRole("button", { name: /borrar «foto\.png»/i }));

    expect(confirmar).toHaveBeenCalled();
    await waitFor(() =>
      expect(peticiones).toContainEqual(
        expect.objectContaining({ url: `/api/archivos/${UUID}`, method: "DELETE" }),
      ),
    );
  });

  it("no borra si se cancela la confirmación", async () => {
    const { peticiones } = montarFetch([imagen]);
    vi.stubGlobal("confirm", vi.fn(() => false));
    const user = userEvent.setup();
    renderAdjuntos();

    await user.click(await screen.findByRole("button", { name: /borrar «foto\.png»/i }));

    expect(peticiones).toHaveLength(0);
  });

  it("«Usar como portada» envía el PATCH con la imagen", async () => {
    const { peticiones } = montarFetch([imagen]);
    const user = userEvent.setup();
    renderAdjuntos();

    await user.click(await screen.findByRole("button", { name: /usar como portada/i }));

    await waitFor(() =>
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1",
        method: "PATCH",
        body: { portada: { tipo: "imagen", archivoId: UUID } },
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("muestra «Quitar portada» cuando la imagen ya es la portada", async () => {
    const { peticiones } = montarFetch([imagen]);
    const user = userEvent.setup();
    renderAdjuntos({ tipo: "imagen", archivoId: UUID });

    const quitar = await screen.findByRole("button", { name: /quitar portada/i });
    expect(screen.queryByRole("button", { name: /usar como portada/i })).toBeNull();

    await user.click(quitar);
    await waitFor(() =>
      expect(peticiones).toContainEqual(
        expect.objectContaining({ url: "/api/tareas/t1", method: "PATCH", body: { portada: null } }),
      ),
    );
  });

  it("no ofrece «Usar como portada» para los que no son imagen", async () => {
    montarFetch([documento]);
    renderAdjuntos();

    expect(await screen.findByText("informe.pdf")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /usar como portada/i })).toBeNull();
  });

  it("formatea el tamaño en B, KB y MB", () => {
    expect(formatearTamano(500)).toBe("500 B");
    expect(formatearTamano(2048)).toBe("2 KB");
    expect(formatearTamano(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
