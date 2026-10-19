import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./i18n/index";
import { BotonVoz } from "./componentes/BotonVoz";
import Asistente from "./paginas/Asistente";
import { SILENCIO_FIN_MS, soportaVoz } from "./voz";

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
  static instancias: ReconocimientoFalso[] = [];

  lang = "";
  continuous = false;
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
    ReconocimientoFalso.instancias.push(this);
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

/** Deja correr las microtareas pendientes (mutaciones de react-query). */
async function dejarCorrerPromesas(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderBoton(inicial = "") {
  function Envoltorio() {
    const [texto, setTexto] = useState(inicial);
    return <BotonVoz texto={texto} alCambiarTexto={setTexto} alEnviar={() => {}} />;
  }
  render(<Envoltorio />);
}

function renderAsistente() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <Asistente />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function respuestaJson(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function botonDictar(): HTMLElement {
  return screen.getByRole("button", { name: "Dictar por voz" });
}

function botonDetener(): HTMLElement {
  return screen.getByRole("button", { name: "Detener el dictado" });
}

function cuadroMensaje(): HTMLTextAreaElement {
  return screen.getByLabelText("Mensaje para el asistente") as HTMLTextAreaElement;
}

describe("BotonVoz", () => {
  beforeEach(() => {
    localStorage.clear();
    ReconocimientoFalso.ultimo = null;
    ReconocimientoFalso.instancias = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sin soporte del navegador no pinta nada", () => {
    expect(soportaVoz()).toBe(false);
    renderBoton();
    expect(screen.queryByRole("button", { name: "Dictar por voz" })).toBeNull();
    expect(screen.queryByLabelText("Idioma del dictado")).toBeNull();
  });

  it("empieza a escuchar en continuo y detiene", () => {
    instalarVoz();
    renderBoton();

    const boton = botonDictar();
    expect(boton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(boton);
    const reconocimiento = ReconocimientoFalso.ultimo!;
    expect(reconocimiento.arranques).toBe(1);
    expect(reconocimiento.continuous).toBe(true);
    expect(reconocimiento.interimResults).toBe(true);
    expect(boton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Escuchando…")).toBeTruthy();

    fireEvent.click(botonDetener());
    expect(reconocimiento.paradas).toBe(1);

    act(() => reconocimiento.onend!(new Event("end")));
    expect(botonDictar().getAttribute("aria-pressed")).toBe("false");
  });

  it("pasa el idioma elegido al reconocimiento y lo recuerda", () => {
    instalarVoz();
    localStorage.setItem("todo-asistente-voz-idioma", "en-US");
    renderBoton();

    const selector = screen.getByLabelText("Idioma del dictado") as HTMLSelectElement;
    expect(selector.value).toBe("en-US");

    fireEvent.change(selector, { target: { value: "ca-ES" } });
    fireEvent.click(botonDictar());

    const reconocimiento = ReconocimientoFalso.ultimo!;
    expect(reconocimiento.lang).toBe("ca-ES");
    expect(localStorage.getItem("todo-asistente-voz-idioma")).toBe("ca-ES");
  });

  it("con el permiso denegado muestra el mensaje y vuelve a idle", () => {
    instalarVoz();
    renderBoton();

    fireEvent.click(botonDictar());
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() => reconocimiento.onerror!(eventoError("not-allowed")));

    expect(screen.getByText(/No hay permiso para usar el micrófono/i)).toBeTruthy();

    act(() => reconocimiento.onend!(new Event("end")));
    expect(botonDictar().getAttribute("aria-pressed")).toBe("false");
  });

  it("el micrófono ocupado se explica y no bloquea un nuevo intento", () => {
    instalarVoz();
    renderBoton();

    fireEvent.click(botonDictar());
    act(() => ReconocimientoFalso.ultimo!.onerror!(eventoError("audio-capture")));
    expect(screen.getByText(/micrófono está ocupado o no disponible/i)).toBeTruthy();

    fireEvent.click(botonDictar());
    expect(ReconocimientoFalso.ultimo!.arranques).toBe(1);
    expect(screen.queryByText(/micrófono está ocupado/i)).toBeNull();
  });
});

describe("dictado continuo", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    ReconocimientoFalso.ultimo = null;
    ReconocimientoFalso.instancias = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("una pausa de dos segundos para pensar no corta la escucha", () => {
    instalarVoz();
    renderBoton();

    fireEvent.click(botonDictar());
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "crea una tarea", esFinal: false }])),
    );

    act(() => vi.advanceTimersByTime(2000));
    expect(reconocimiento.paradas).toBe(0);
    expect(botonDetener()).toBeTruthy();
    expect(screen.getByText("Escuchando…")).toBeTruthy();
  });

  it("cinco segundos seguidos sin resultados cierran la escucha", () => {
    instalarVoz();
    renderBoton();

    fireEvent.click(botonDictar());
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "crea una tarea", esFinal: false }])),
    );

    act(() => vi.advanceTimersByTime(SILENCIO_FIN_MS - 1));
    expect(reconocimiento.paradas).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    expect(reconocimiento.paradas).toBe(1);

    act(() => reconocimiento.onend!(new Event("end")));
    expect(botonDictar().getAttribute("aria-pressed")).toBe("false");
  });

  it("cada resultado reinicia la cuenta del silencio", () => {
    instalarVoz();
    renderBoton();

    fireEvent.click(botonDictar());
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() => reconocimiento.onresult!(eventoResultados([{ texto: "uno", esFinal: false }])));

    act(() => vi.advanceTimersByTime(4000));
    act(() => reconocimiento.onresult!(eventoResultados([{ texto: "dos", esFinal: false }])));
    act(() => vi.advanceTimersByTime(4000));
    expect(reconocimiento.paradas).toBe(0);

    act(() => vi.advanceTimersByTime(1000));
    expect(reconocimiento.paradas).toBe(1);
  });

  it("acumula los finales sin duplicar los que llegan de nuevo", () => {
    instalarVoz();
    renderAsistente();

    fireEvent.click(botonDictar());
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "Crea una tarea", esFinal: true }])),
    );
    expect(cuadroMensaje().value).toBe("Crea una tarea");

    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "Crea una tarea", esFinal: true }])),
    );
    expect(cuadroMensaje().value).toBe("Crea una tarea");

    act(() =>
      reconocimiento.onresult!(
        eventoResultados(
          [
            { texto: "Crea una tarea", esFinal: true },
            { texto: "mañana", esFinal: true },
          ],
          1,
        ),
      ),
    );
    expect(cuadroMensaje().value).toBe("Crea una tarea mañana");
  });

  it("si el navegador cierra la sesión, la reinicia conservando el texto", () => {
    instalarVoz();
    renderAsistente();

    fireEvent.click(botonDictar());
    const primero = ReconocimientoFalso.ultimo!;
    act(() => primero.onresult!(eventoResultados([{ texto: "Hola", esFinal: true }])));
    expect(cuadroMensaje().value).toBe("Hola");

    act(() => primero.onend!(new Event("end")));
    const segundo = ReconocimientoFalso.ultimo!;
    expect(segundo).not.toBe(primero);
    expect(segundo.arranques).toBe(1);
    expect(segundo.continuous).toBe(true);
    expect(cuadroMensaje().value).toBe("Hola");
    expect(botonDetener()).toBeTruthy();
  });

  it("pone un tope a los reinicios seguidos sin resultados", () => {
    instalarVoz();
    renderAsistente();

    fireEvent.click(botonDictar());
    // La sesión se cierra sola una y otra vez sin ningún resultado nuevo.
    for (let i = 0; i < 6; i += 1) {
      act(() => ReconocimientoFalso.ultimo!.onend!(new Event("end")));
    }

    // El primero más cinco reintentos: a partir de ahí deja de reintentar.
    expect(ReconocimientoFalso.instancias).toHaveLength(6);
    expect(botonDictar().getAttribute("aria-pressed")).toBe("false");
  });

  it("reintenta los errores recuperables y solo avisa si se agotan", () => {
    instalarVoz();
    renderBoton();

    fireEvent.click(botonDictar());
    // Un fallo de red no corta el dictado: se reintenta.
    act(() => ReconocimientoFalso.ultimo!.onerror!(eventoError("network")));
    expect(screen.getByText("Escuchando…")).toBeTruthy();
    act(() => ReconocimientoFalso.ultimo!.onend!(new Event("end")));
    expect(botonDetener()).toBeTruthy();

    // Sí lo hace cuando se agotan los reintentos.
    for (let i = 0; i < 5; i += 1) {
      act(() => ReconocimientoFalso.ultimo!.onerror!(eventoError("network")));
      act(() => ReconocimientoFalso.ultimo!.onend!(new Event("end")));
    }
    expect(screen.getByText(/Sin conexión con el servicio de dictado/i)).toBeTruthy();
    expect(botonDictar().getAttribute("aria-pressed")).toBe("false");
  });
});

describe("dictado en el chat", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    ReconocimientoFalso.ultimo = null;
    ReconocimientoFalso.instancias = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("añade el texto parcial y el final al cuadro sin borrar lo escrito", () => {
    instalarVoz();
    renderAsistente();

    const cuadro = cuadroMensaje();
    fireEvent.change(cuadro, { target: { value: "Nota previa" } });
    fireEvent.click(botonDictar());

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

  it("con la casilla desactivada no envía y deja el texto en el cuadro", () => {
    instalarVoz();
    const fetchFalso = vi.fn(async () => respuestaJson({ mensaje: "Hecho", acciones: [] }));
    vi.stubGlobal("fetch", fetchFalso);
    renderAsistente();

    fireEvent.click(botonDictar());
    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "Crea una tarea", esFinal: true }])),
    );
    expect(cuadroMensaje().value).toBe("Crea una tarea");

    act(() => vi.advanceTimersByTime(SILENCIO_FIN_MS));
    act(() => reconocimiento.onend!(new Event("end")));

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(cuadroMensaje().value).toBe("Crea una tarea");
  });

  it("con la casilla activada envía al terminar por silencio, nunca antes", async () => {
    instalarVoz();
    const cuerpos: Array<{ mensajes: Array<{ rol: string; texto: string }> }> = [];
    const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/asistente/chat") {
        cuerpos.push(JSON.parse(String(init?.body)) as { mensajes: [] });
        return respuestaJson({ mensaje: "Hecho", acciones: [] });
      }
      return respuestaJson([]);
    });
    vi.stubGlobal("fetch", fetchFalso);

    renderAsistente();
    fireEvent.click(screen.getByLabelText("Enviar al terminar"));
    fireEvent.click(botonDictar());

    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "Crea una tarea", esFinal: true }])),
    );
    expect(fetchFalso).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SILENCIO_FIN_MS));
    act(() => reconocimiento.onend!(new Event("end")));

    await dejarCorrerPromesas();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(cuerpos[0]!.mensajes.at(-1)).toEqual({ rol: "user", texto: "Crea una tarea" });
    expect(localStorage.getItem("todo-asistente-voz-envio")).toBe("1");
  });

  it("con la casilla activada envía al pulsar el botón de detener", async () => {
    instalarVoz();
    const fetchFalso = vi.fn(async () => respuestaJson({ mensaje: "Hecho", acciones: [] }));
    vi.stubGlobal("fetch", fetchFalso);

    renderAsistente();
    fireEvent.click(screen.getByLabelText("Enviar al terminar"));
    fireEvent.click(botonDictar());

    const reconocimiento = ReconocimientoFalso.ultimo!;
    act(() =>
      reconocimiento.onresult!(eventoResultados([{ texto: "Crea una tarea", esFinal: true }])),
    );
    expect(fetchFalso).not.toHaveBeenCalled();

    fireEvent.click(botonDetener());
    act(() => reconocimiento.onend!(new Event("end")));

    await dejarCorrerPromesas();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
