import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import { type ArchivoApi, type ProyectoApi } from "../api";
import { PersonalizarProyecto } from "./PersonalizarProyecto";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const IMAGEN_A: ArchivoApi = {
  id: UUID_A,
  nombre: "uno.png",
  mime: "image/png",
  tamano: 2048,
  createdAt: "",
};

const IMAGEN_B: ArchivoApi = {
  id: UUID_B,
  nombre: "dos.jpg",
  mime: "image/jpeg",
  tamano: 4096,
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
}

function montarFetch(inicial: ArchivoApi[] = [], estadoSubida = 201) {
  let lista = [...inicial];
  const peticiones: Peticion[] = [];
  let subidas = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = String(init?.method ?? "GET").toUpperCase();

      if (url === "/api/proyectos/p1/fondos" && method === "GET") return json(lista);

      peticiones.push({
        url,
        method,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : (init?.body ?? null),
      });

      if (url === "/api/proyectos/p1/fondos" && method === "POST") {
        if (estadoSubida !== 201) {
          return json({ mensaje: "El archivo supera el tamaño máximo" }, estadoSubida);
        }
        subidas += 1;
        const datos = init?.body as FormData;
        const fichero = datos.get("archivo") as File;
        const creado: ArchivoApi = {
          id: subidas === 1 ? UUID_A : UUID_B,
          nombre: fichero.name,
          mime: "image/png",
          tamano: fichero.size,
          createdAt: "",
        };
        lista = [creado, ...lista];
        return json(creado, 201);
      }

      if (url.startsWith("/api/archivos/") && method === "DELETE") {
        const id = url.slice("/api/archivos/".length);
        lista = lista.filter((archivo) => archivo.id !== id);
        return new Response(null, { status: 204 });
      }

      if (url === "/api/proyectos/p1" && method === "PATCH") return json({ id: "p1" });

      return json({}, 404);
    }),
  );

  return { peticiones, listaActual: () => lista };
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

function renderizar(proyecto: ProyectoApi, onCerrar = vi.fn()) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <PersonalizarProyecto proyecto={proyecto} abierto onCerrar={onCerrar} />
    </QueryClientProvider>,
  );
  return { onCerrar };
}

function archivoGrande(): File {
  const fichero = new File(["x"], "grande.png", { type: "image/png" });
  Object.defineProperty(fichero, "size", { value: 11 * 1024 * 1024 });
  return fichero;
}

describe("PersonalizarProyecto", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("muestra los valores actuales al abrir", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json([])));

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
        if (url === "/api/proyectos/p1/fondos") return json([]);
        if (url === "/api/proyectos/p1" && (init?.method ?? "GET") === "PATCH") {
          cuerpo = JSON.parse(String(init?.body ?? "{}"));
          return json({ id: "p1" });
        }
        return json({}, 404);
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
        if (url === "/api/proyectos/p1/fondos") return json([]);
        if (url === "/api/proyectos/p1" && (init?.method ?? "GET") === "PATCH") {
          cuerpo = JSON.parse(String(init?.body ?? "{}"));
          return json({ id: "p1" });
        }
        return json({}, 404);
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

  it("mantiene la sección Imágenes activa, sin «Próximamente»", async () => {
    montarFetch();

    renderizar(proyectoBase());
    await screen.findByRole("dialog");

    expect(screen.queryByText("Próximamente")).toBeNull();
    const grupo = screen.getByText("Imágenes").closest("fieldset");
    expect(grupo).not.toBeNull();
    expect((grupo as HTMLFieldSetElement).disabled).toBe(false);
    expect(await screen.findByText("Todavía no hay imágenes")).toBeTruthy();
  });

  it("sube las imágenes una a una por multipart", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();

    renderizar(proyectoBase());
    await screen.findByText("Todavía no hay imágenes");

    await user.upload(screen.getByLabelText("Elegir imágenes"), [
      new File(["a"], "uno.png", { type: "image/png" }),
      new File(["b"], "dos.jpg", { type: "image/jpeg" }),
    ]);

    await waitFor(() =>
      expect(peticiones.filter((peticion) => peticion.method === "POST")).toHaveLength(2),
    );

    const subidas = peticiones.filter((peticion) => peticion.method === "POST");
    expect(subidas.every((peticion) => peticion.url === "/api/proyectos/p1/fondos")).toBe(true);
    expect(subidas[0]?.body).toBeInstanceOf(FormData);
    expect((subidas[0]?.body as FormData).get("archivo")).toBeInstanceOf(File);
    expect(await screen.findByText("uno.png")).toBeTruthy();
  });

  it("ordena, cambia el intervalo y guarda el fondo con los ids en orden", async () => {
    const { peticiones } = montarFetch([IMAGEN_A, IMAGEN_B]);
    const user = userEvent.setup();

    renderizar(
      proyectoBase({
        fondo: { tipo: "imagenes", ids: [UUID_A, UUID_B], intervaloSeg: 30 },
      }),
    );

    expect(await screen.findByText("uno.png")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Subir «dos.jpg»" }));
    const intervalo = screen.getByLabelText(/intervalo/i) as HTMLInputElement;
    expect(intervalo.value).toBe("30");
    await user.clear(intervalo);
    await user.type(intervalo, "45");
    await user.click(screen.getByRole("button", { name: "Usar imágenes como fondo" }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() =>
      expect(peticiones.filter((peticion) => peticion.method === "PATCH")).toHaveLength(1),
    );
    expect(peticiones.find((peticion) => peticion.method === "PATCH")?.body).toEqual({
      fondo: { tipo: "imagenes", ids: [UUID_B, UUID_A], intervaloSeg: 45 },
    });
  });

  it("quita una imagen con confirmación y envía DELETE", async () => {
    const { peticiones } = montarFetch([IMAGEN_A, IMAGEN_B]);
    const confirmar = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmar);
    const user = userEvent.setup();

    renderizar(
      proyectoBase({
        fondo: { tipo: "imagenes", ids: [UUID_A, UUID_B], intervaloSeg: 30 },
      }),
    );

    expect(await screen.findByText("uno.png")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Quitar «uno.png»" }));

    expect(confirmar).toHaveBeenCalled();
    await waitFor(() =>
      expect(peticiones).toContainEqual(
        expect.objectContaining({ url: `/api/archivos/${UUID_A}`, method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("uno.png")).toBeNull());
    expect(screen.getByText("dos.jpg")).toBeTruthy();
  });

  it("muestra el error de la API si falla", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ mensaje: "No se pudo guardar" }, 500)),
    );

    renderizar(proyectoBase());
    const user = userEvent.setup();

    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Coral" }));
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    expect(await screen.findByText("No se pudo guardar")).toBeTruthy();
  });

  it("no sube más de 10 imágenes ni archivos de más de 10 MB", async () => {
    const diez = Array.from({ length: 10 }, (_, indice) => ({
      ...IMAGEN_A,
      id: `${String(indice + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
      nombre: `imagen-${indice + 1}.png`,
    }));
    const { peticiones } = montarFetch(diez);
    const user = userEvent.setup();

    renderizar(proyectoBase());
    await screen.findByText("imagen-1.png");

    await user.upload(
      screen.getByLabelText("Elegir imágenes"),
      new File(["x"], "once.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Ya hay 10 imágenes en el proyecto",
    );
    expect(peticiones.filter((peticion) => peticion.method === "POST")).toHaveLength(0);
  });

  it("rechaza sin petición una imagen de más de 10 MB", async () => {
    const { peticiones } = montarFetch();
    const user = userEvent.setup();

    renderizar(proyectoBase());
    await screen.findByText("Todavía no hay imágenes");

    await user.upload(screen.getByLabelText("Elegir imágenes"), archivoGrande());

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Cada imagen puede ocupar como máximo 10 MB",
    );
    expect(peticiones.filter((peticion) => peticion.method === "POST")).toHaveLength(0);
  });

  it("traduce el 413 de la API a un mensaje claro", async () => {
    montarFetch([], 413);
    const user = userEvent.setup();

    renderizar(proyectoBase());
    await screen.findByText("Todavía no hay imágenes");

    await user.upload(
      screen.getByLabelText("Elegir imágenes"),
      new File(["x"], "foto.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Cada imagen puede ocupar como máximo 10 MB",
    );
  });
});
