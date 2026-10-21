import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import Ajustes from "./paginas/Ajustes";
import Asistente from "./paginas/Asistente";

const CLAVE_CONVERSACION = "todo-asistente-conversacion";

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderAjustes() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <Ajustes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { cliente, user };
}

function renderAsistente() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <Asistente />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { cliente, user };
}

const SIN_CONFIGURAR = {
  disponible: true,
  configurado: false,
  preset: null,
  baseUrl: null,
  modelo: null,
  razonamiento: null,
  claveTermina: null,
};

describe("Ajustes · tarjeta del Asistente", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("avisa de que falta la variable de entorno si el asistente no está disponible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/config") {
          return respuestaJson({ ...SIN_CONFIGURAR, disponible: false });
        }
        return respuestaJson([]);
      }),
    );

    renderAjustes();

    expect(await screen.findByText(/ASISTENTE_CLAVE_CIFRADO/)).toBeTruthy();
    expect(screen.queryByLabelText("Proveedor")).toBeNull();
  });

  it("ofrece OpenCode Go con sus valores por defecto y su ayuda", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/config") {
          return respuestaJson(SIN_CONFIGURAR);
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAjustes();

    await user.selectOptions(
      await screen.findByLabelText("Proveedor"),
      "opencode-go",
    );
    expect((screen.getByLabelText("URL base") as HTMLInputElement).value).toBe(
      "https://opencode.ai/inference/go/openai/v1",
    );
    expect((screen.getByLabelText("Modelo") as HTMLInputElement).value).toBe(
      "deepseek-v4.1-flash",
    );
    expect(screen.getByText(/consola de OpenCode/)).toBeTruthy();
    expect(screen.getByText(/gpt-6-luna no funciona/)).toBeTruthy();
    expect(screen.getByText(/bajo tu cuenta y riesgo/)).toBeTruthy();
  });

  it("rellena los campos con el preset y guarda sin perder la clave", async () => {
    let cuerpo: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const metodo = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/asistente/config" && metodo === "PUT") {
          cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return respuestaJson({
            disponible: true,
            configurado: true,
            preset: "openai",
            baseUrl: "https://api.openai.com/v1",
            modelo: "gpt-6-luna",
            razonamiento: "none",
            claveTermina: "…1234",
          });
        }
        if (url === "/api/asistente/config") {
          return respuestaJson(SIN_CONFIGURAR);
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAjustes();

    await user.selectOptions(await screen.findByLabelText("Proveedor"), "openai");
    expect((screen.getByLabelText("URL base") as HTMLInputElement).value).toBe(
      "https://api.openai.com/v1",
    );
    expect((screen.getByLabelText("Modelo") as HTMLInputElement).value).toBe("gpt-6-luna");

    await user.type(screen.getByLabelText("Clave de API"), "sk-secreta-1234");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(cuerpo).not.toBeNull());
    expect(cuerpo).toMatchObject({
      preset: "openai",
      baseUrl: "https://api.openai.com/v1",
      modelo: "gpt-6-luna",
      razonamiento: "none",
      clave: "sk-secreta-1234",
    });
    expect(await screen.findByText(/Guardada, termina en …1234/)).toBeTruthy();
  });

  it("no rellena el campo con la clave guardada y usa un campo de contraseña", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/config") {
          return respuestaJson({
            disponible: true,
            configurado: true,
            preset: "deepseek",
            baseUrl: "https://api.deepseek.com",
            modelo: "deepseek-flash",
            razonamiento: null,
            claveTermina: "…9876",
          });
        }
        return respuestaJson([]);
      }),
    );

    renderAjustes();

    expect(await screen.findByText(/Guardada, termina en …9876/)).toBeTruthy();
    expect((screen.getByLabelText("URL base") as HTMLInputElement).value).toBe(
      "https://api.deepseek.com",
    );
    const campo = screen.getByLabelText("Nueva clave") as HTMLInputElement;
    expect(campo.type).toBe("password");
    expect(campo.value).toBe("");
  });

  it("prueba la conexión y muestra el mensaje del proveedor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const metodo = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/asistente/probar" && metodo === "POST") {
          return respuestaJson({ ok: false, mensaje: "La clave no es válida" });
        }
        return respuestaJson(SIN_CONFIGURAR);
      }),
    );

    const { user } = renderAjustes();
    await user.click(await screen.findByRole("button", { name: "Probar conexión" }));

    expect(await screen.findByText("La clave no es válida")).toBeTruthy();
  });

  it("quita la configuración guardada", async () => {
    let borrado = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const metodo = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/asistente/config" && metodo === "DELETE") {
          borrado = true;
          return new Response(null, { status: 204 });
        }
        if (url === "/api/asistente/config") {
          return respuestaJson({
            disponible: true,
            configurado: true,
            preset: "deepseek",
            baseUrl: "https://api.deepseek.com",
            modelo: "deepseek-flash",
            razonamiento: null,
            claveTermina: "…9876",
          });
        }
        return respuestaJson([]);
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { user } = renderAjustes();
    await user.click(await screen.findByRole("button", { name: "Quitar configuración" }));

    await waitFor(() => expect(borrado).toBe(true));
    expect(await screen.findByText(/Configuración eliminada/)).toBeTruthy();
  });
});

interface CuerpoChat {
  mensajes: Array<{ rol: string; texto: string }>;
  conversacionId?: string;
  zona?: string;
}

describe("Página Asistente", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("envía un mensaje y muestra la respuesta con sus acciones y refresca las consultas", async () => {
    let cuerpo: CuerpoChat | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/asistente/chat") {
          cuerpo = JSON.parse(String(init?.body)) as CuerpoChat;
          return respuestaJson({
            mensaje: "He creado la tarea.",
            acciones: [
              {
                herramienta: "crear_tarea",
                resumen: "Tarea «Llamar al banco» creada",
                enlace: "/proyectos/p1/tareas/t1",
              },
            ],
          });
        }
        return respuestaJson([]);
      }),
    );

    const { cliente, user } = renderAsistente();
    const espia = vi.spyOn(cliente, "invalidateQueries");

    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Crea una tarea");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("He creado la tarea.")).toBeTruthy();
    expect(screen.getByText("Crea una tarea")).toBeTruthy();
    const enlace = screen.getByRole("link", { name: "Tarea «Llamar al banco» creada" });
    expect(enlace.getAttribute("href")).toBe("/proyectos/p1/tareas/t1");

    expect(cuerpo).not.toBeNull();
    expect(cuerpo!.mensajes.at(-1)).toEqual({ rol: "user", texto: "Crea una tarea" });
    expect(typeof cuerpo!.zona).toBe("string");

    await waitFor(() => {
      const claves = espia.mock.calls.map((llamada) =>
        JSON.stringify((llamada[0] as { queryKey: unknown }).queryKey),
      );
      expect(claves).toContain('["proyectos"]');
      expect(claves).toContain('["tareas"]');
      expect(claves).toContain('["agenda"]');
      expect(claves).toContain('["hoy"]');
    });
  });

  it("recorta el historial a los 20 últimos mensajes", async () => {
    let cuerpo: CuerpoChat | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/asistente/chat") {
          cuerpo = JSON.parse(String(init?.body)) as CuerpoChat;
          return respuestaJson({ mensaje: "Vale", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const previos = Array.from({ length: 25 }, (_, indice) => ({
      id: `m${indice}`,
      rol: indice % 2 === 0 ? "user" : "assistant",
      texto: `mensaje ${indice}`,
    }));
    sessionStorage.setItem(CLAVE_CONVERSACION, JSON.stringify(previos));

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Otro{Enter}");

    expect(await screen.findByText("Vale")).toBeTruthy();
    expect(cuerpo).not.toBeNull();
    expect(cuerpo!.mensajes).toHaveLength(20);
    expect(cuerpo!.mensajes.at(-1)).toEqual({ rol: "user", texto: "Otro" });
  });

  it("muestra el indicador «Escribiendo…» mientras espera", async () => {
    let resolver: ((respuesta: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolverPromesa) => {
            resolver = resolverPromesa;
          }),
      ),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Hola{Enter}");

    expect(await screen.findByText("Escribiendo…")).toBeTruthy();
    resolver!(respuestaJson({ mensaje: "Hola, ¿en qué te ayudo?", acciones: [] }));
    expect(await screen.findByText("Hola, ¿en qué te ayudo?")).toBeTruthy();
    expect(screen.queryByText("Escribiendo…")).toBeNull();
  });

  it("da formato a la respuesta y permite copiarla", async () => {
    const texto =
      "# Manual\n\nIntroducción con **negrita**.\n\n- uno\n- dos\n\n```\nconst x = 1;\n```";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/chat") {
          return respuestaJson({ mensaje: texto, acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Manual{Enter}");

    expect(await screen.findByRole("heading", { name: "Manual" })).toBeTruthy();
    expect(screen.getByText("negrita").tagName).toBe("STRONG");
    expect(screen.getByText("uno")).toBeTruthy();
    expect(screen.getByText("const x = 1;")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Copiar" }));
    expect(await screen.findByRole("button", { name: "Copiado" })).toBeTruthy();
  });

  it("Enter envía y Mayús+Enter añade un salto de línea", async () => {
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/chat") {
          llamadas += 1;
          return respuestaJson({ mensaje: "Hecho", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    const cuadro = screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement;

    await user.type(cuadro, "primera{Shift>}{Enter}{/Shift}segunda");
    expect(cuadro.value).toBe("primera\nsegunda");
    expect(llamadas).toBe(0);

    await user.type(cuadro, "{Enter}");
    expect(await screen.findByText("Hecho")).toBeTruthy();
    expect(llamadas).toBe(1);
  });

  it("sin configurar (409) muestra el aviso con enlace a Ajustes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/chat") {
          return respuestaJson(
            {
              mensaje:
                "El asistente no está configurado. Configura tu proveedor de IA en Ajustes.",
              configurar: true,
            },
            409,
          );
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Hola{Enter}");

    expect(await screen.findByText(/no está configurado/i)).toBeTruthy();
    const enlace = screen.getByRole("link", { name: "Ir a Ajustes" });
    expect(enlace.getAttribute("href")).toBe("/ajustes");
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("ante un 502 permite reintentar el último mensaje", async () => {
    const cuerpos: CuerpoChat[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/asistente/chat") {
          cuerpos.push(JSON.parse(String(init?.body)) as CuerpoChat);
          if (cuerpos.length === 1) {
            return respuestaJson({ mensaje: "El proveedor no responde." }, 502);
          }
          return respuestaJson({ mensaje: "Ahora sí", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Reintenta esto{Enter}");

    expect(await screen.findByText("El proveedor no responde.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Ahora sí")).toBeTruthy();
    expect(cuerpos).toHaveLength(2);
    expect(cuerpos[1]!.mensajes.at(-1)).toEqual({ rol: "user", texto: "Reintenta esto" });
  });

  it("nueva conversación vacía el hilo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/chat") {
          return respuestaJson({ mensaje: "Hecho", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Hola{Enter}");
    expect(await screen.findByText("Hecho")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Nueva conversación" }));

    expect(await screen.findByText("¿En qué te ayudo?")).toBeTruthy();
    expect(screen.queryByText("Hecho")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(CLAVE_CONVERSACION) ?? "{}").mensajes).toEqual([]);
  });

  it("mantiene el conversacionId en mensajes sucesivos y lo renueva con «Nueva conversación»", async () => {
    const cuerpos: CuerpoChat[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/asistente/chat") {
          cuerpos.push(JSON.parse(String(init?.body)) as CuerpoChat);
          return respuestaJson({ mensaje: "Vale", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Hola{Enter}");
    await waitFor(() => expect(cuerpos).toHaveLength(1));
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Otra{Enter}");
    await waitFor(() => expect(cuerpos).toHaveLength(2));

    const primero = cuerpos[0]!.conversacionId;
    expect(primero).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(cuerpos[1]!.conversacionId).toBe(primero);

    await user.click(screen.getByRole("button", { name: "Nueva conversación" }));
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Después{Enter}");
    await waitFor(() => expect(cuerpos).toHaveLength(3));
    expect(cuerpos[2]!.conversacionId).not.toBe(primero);
  });

  it("los ejemplos del estado vacío rellenan el cuadro de mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson([])));

    const { user } = renderAsistente();
    await user.click(
      screen.getByRole("button", { name: "Crea una tarea mañana a las 10 para llamar al banco" }),
    );

    expect((screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement).value).toBe(
      "Crea una tarea mañana a las 10 para llamar al banco",
    );
  });

  it("sin red muestra un error legible dentro del hilo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/chat") {
          throw new TypeError("Failed to fetch");
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Hola{Enter}");

    expect(await screen.findByText(/No hay conexión con el servidor/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("adjunta un archivo de texto como pastilla y envía su contenido con delimitadores", async () => {
    let cuerpo: CuerpoChat | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/asistente/chat") {
          cuerpo = JSON.parse(String(init?.body)) as CuerpoChat;
          return respuestaJson({ mensaje: "Vale", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.upload(
      screen.getByLabelText("Seleccionar archivos para adjuntar"),
      new File(["# Notas\nhola"], "notas.md", { type: "text/markdown" }),
    );

    expect(await screen.findByText("notas.md")).toBeTruthy();
    expect(screen.getByText("12 B")).toBeTruthy();

    await user.type(screen.getByLabelText("Mensaje para el asistente"), "Convierte esto en tareas");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByText("Vale")).toBeTruthy();
    expect(cuerpo).not.toBeNull();
    expect(cuerpo!.mensajes.at(-1)!.texto).toBe(
      "Convierte esto en tareas\n\n[Archivo adjunto: notas.md]\n# Notas\nhola\n[Fin del archivo]",
    );
    expect(screen.getByText("notas.md")).toBeTruthy();
  });

  it("rechaza los archivos binarios", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson([])),
    );

    const { user } = renderAsistente();
    await user.upload(
      screen.getByLabelText("Seleccionar archivos para adjuntar"),
      new File(["texto\u0000binario"], "datos.txt", { type: "text/plain" }),
    );

    expect(await screen.findByText(/parece un archivo binario/)).toBeTruthy();
    expect(screen.queryByText("datos.txt")).toBeNull();
  });

  it("rechaza más de tres archivos por mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson([])),
    );

    const { user } = renderAsistente();
    const archivos = Array.from(
      { length: 4 },
      (_, indice) => new File(["x"], `f${indice}.txt`, { type: "text/plain" }),
    );
    await user.upload(screen.getByLabelText("Seleccionar archivos para adjuntar"), archivos);

    expect(await screen.findByText(/máximo 3 archivos/)).toBeTruthy();
    expect(screen.queryByText("f0.txt")).toBeNull();
  });

  it("rechaza un archivo de más de 100 000 caracteres e indica el límite", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson([])),
    );

    const { user } = renderAsistente();
    await user.upload(
      screen.getByLabelText("Seleccionar archivos para adjuntar"),
      new File(["a".repeat(100_001)], "grande.txt", { type: "text/plain" }),
    );

    expect(await screen.findByText(/supera el límite de 100000 caracteres/)).toBeTruthy();
    expect(screen.queryByText("grande.txt")).toBeNull();
  });

  it("quita una pastilla de adjunto antes de enviar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson([])),
    );

    const { user } = renderAsistente();
    await user.upload(
      screen.getByLabelText("Seleccionar archivos para adjuntar"),
      new File(["hola"], "notas.md", { type: "text/markdown" }),
    );
    expect(await screen.findByText("notas.md")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Quitar notas.md" }));

    expect(screen.queryByText("notas.md")).toBeNull();
  });

  it("muestra el contador al acercarse al límite y bloquea el envío al superarlo", async () => {
    let llamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/asistente/chat") {
          llamadas += 1;
          return respuestaJson({ mensaje: "Vale", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    const cuadro = screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement;

    fireEvent.change(cuadro, { target: { value: "a".repeat(96_001) } });
    expect(screen.getByText(/96\.001 de 120\.000 caracteres/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.change(cuadro, { target: { value: "a".repeat(120_001) } });
    expect(await screen.findByText(/El mensaje es demasiado largo/)).toBeTruthy();
    const enviar = screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    await user.click(enviar);
    expect(llamadas).toBe(0);

    fireEvent.change(cuadro, { target: { value: "Corto" } });
    await user.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("Vale")).toBeTruthy();
    expect(llamadas).toBe(1);
  });
});
