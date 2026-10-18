import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import { BotonVoz } from "./componentes/BotonVoz";
import Asistente from "./paginas/Asistente";
import { soportaVoz } from "./voz";

interface OpcionResultado {
  texto: string;
  esFinal: boolean;
}

function eventoResultados(partes: OpcionResultado[], indice = 0): SpeechRecognitionEvent {
  const resultados = partes.map((parte) => {
    const alternativa = { transcript: parte.texto, confidence: 1 };
    return { isFinal: parte.esFinal, length: 1, item: () => alternativa, 0: alternativa };
  });
  const lista = {
    length: resultados.length,
    item: (posicion: number) => resultados[posicion],
    ...Object.fromEntries(resultados.map((resultado, posicion) => [posicion, resultado])),
  };
  return { resultIndex: indice, results: lista } as unknown as SpeechRecognitionEvent;
}

function eventoError(codigo: string): SpeechRecognitionErrorEvent {
  return { error: codigo, message: codigo } as unknown as SpeechRecognitionErrorEvent;
}

class ReconocimientoFalso {
  static ultimo: ReconocimientoFalso | null = null;

  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((evento: SpeechRecognitionEvent) => void) | null = null;
  onerror: ((evento: SpeechRecognitionErrorEvent) => void) | null = null;
  onend: ((evento: Event) => void) | null = null;
  arranques = 0;
  paradas = 0;
  abortado = false;

  constructor() {
    ReconocimientoFalso.ultimo = this;
  }

  start(): void {
    this.arranques += 1;
  }

  stop(): void {
    this.paradas += 1;
  }

  abort(): void {
    this.abortado = true;
  }
}

function instalarVoz(): void {
  vi.stubGlobal("SpeechRecognition", ReconocimientoFalso);
}

function renderBoton(inicial = "") {
  const user = userEvent.setup();
  function Envoltorio() {
    const [texto, setTexto] = useState(inicial);
    return <BotonVoz texto={texto} alCambiarTexto={setTexto} alEnviar={() => {}} />;
  }
  render(<Envoltorio />);
  return { user };
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
  return { user };
}

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("BotonVoz", () => {
  beforeEach(() => {
    localStorage.clear();
    ReconocimientoFalso.ultimo = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sin soporte del navegador no pinta nada", () => {
    expect(soportaVoz()).toBe(false);
    renderBoton();
    expect(screen.queryByRole("button", { name: "Dictar por voz" })).toBeNull();
    expect(screen.queryByLabelText("Idioma del dictado")).toBeNull();
  });

  it("empieza a escuchar y detiene", async () => {
    instalarVoz();
    const { user } = renderBoton();

    const boton = screen.getByRole("button", { name: "Dictar por voz" });
    expect(boton.getAttribute("aria-pressed")).toBe("false");

    await user.click(boton);
    const reconocimiento = ReconocimientoFalso.ultimo!;
    expect(reconocimiento.arranques).toBe(1);
    expect(boton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Escuchando…")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Detener el dictado" }));
    expect(reconocimiento.paradas).toBe(1);

    act(() => reconocimiento.onend!(new Event("end")));
    expect(screen.getByRole("button", { name: "Dictar por voz" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("pasa el idioma elegido al reconocimiento y lo recuerda", async () => {
    instalarVoz();
    localStorage.setItem("todo-asistente-voz-idioma", "en-US");
    const { user } = renderBoton();

    const selector = screen.getByLabelText("Idioma del dictado") as HTMLSelectElement;
    expect(selector.value).toBe("en-US");

    await user.selectOptions(selector, "ca-ES");
    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));

    const reconocimiento = ReconocimientoFalso.ultimo!;
    expect(reconocimiento.lang).toBe("ca-ES");
    expect(reconocimiento.continuous).toBe(false);
    expect(reconocimiento.interimResults).toBe(true);
    expect(localStorage.getItem("todo-asistente-voz-idioma")).toBe("ca-ES");
  });

  it("con el permiso denegado muestra el mensaje y vuelve a idle", async () => {
    instalarVoz();
    const { user } = renderBoton();

    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() => reconocimiento.onerror!(eventoError("not-allowed")));

    expect(await screen.findByText(/No hay permiso para usar el micrófono/i)).toBeTruthy();

    act(() => reconocimiento.onend!(new Event("end")));
    expect(screen.getByRole("button", { name: "Dictar por voz" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("el micrófono ocupado se explica y no bloquea un nuevo intento", async () => {
    instalarVoz();
    const { user } = renderBoton();

    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));
    act(() => ReconocimientoFalso.ultimo!.onerror!(eventoError("audio-capture")));
    expect(await screen.findByText(/micrófono está ocupado o no disponible/i)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));
    expect(ReconocimientoFalso.ultimo!.arranques).toBe(1);
    expect(screen.queryByText(/micrófono está ocupado/i)).toBeNull();
  });
});

describe("dictado en el chat", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    ReconocimientoFalso.ultimo = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("añade el texto parcial y el final al cuadro sin borrar lo escrito", async () => {
    instalarVoz();
    const { user } = renderAsistente();

    const cuadro = screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement;
    await user.type(cuadro, "Nota previa");
    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));

    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() => reconocimiento.onresult!(eventoResultados([{ texto: "mañana", esFinal: false }])));
    expect(cuadro.value).toBe("Nota previa mañana");

    act(() => reconocimiento.onresult!(eventoResultados([{ texto: "mañana", esFinal: true }])));
    expect(cuadro.value).toBe("Nota previa mañana");

    act(() =>
      reconocimiento.onresult!(
        eventoResultados(
          [
            { texto: "mañana", esFinal: true },
            { texto: "a las diez", esFinal: false },
          ],
          1,
        ),
      ),
    );
    expect(cuadro.value).toBe("Nota previa mañana a las diez");
  });

  it("no envía solo si la casilla está desactivada", async () => {
    instalarVoz();
    const fetchFalso = vi.fn(async () => respuestaJson({ mensaje: "Hecho", acciones: [] }));
    vi.stubGlobal("fetch", fetchFalso);
    const { user } = renderAsistente();

    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));
    act(() =>
      ReconocimientoFalso.ultimo!.onresult!(
        eventoResultados([{ texto: "Crea una tarea", esFinal: true }]),
      ),
    );

    expect(screen.getByLabelText("Mensaje para el asistente")).toHaveProperty(
      "value",
      "Crea una tarea",
    );
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("envía al terminar de hablar si la casilla está activada", async () => {
    instalarVoz();
    const cuerpos: Array<{ mensajes: Array<{ rol: string; texto: string }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/asistente/chat") {
          cuerpos.push(JSON.parse(String(init?.body)) as { mensajes: [] });
          return respuestaJson({ mensaje: "Hecho", acciones: [] });
        }
        return respuestaJson([]);
      }),
    );

    const { user } = renderAsistente();
    await user.click(screen.getByLabelText("Enviar al terminar"));
    await user.click(screen.getByRole("button", { name: "Dictar por voz" }));
    act(() =>
      ReconocimientoFalso.ultimo!.onresult!(
        eventoResultados([{ texto: "Crea una tarea", esFinal: true }]),
      ),
    );

    expect(await screen.findByText("Hecho")).toBeTruthy();
    expect(cuerpos[0]!.mensajes.at(-1)).toEqual({ rol: "user", texto: "Crea una tarea" });
    expect(localStorage.getItem("todo-asistente-voz-envio")).toBe("1");
  });
});
