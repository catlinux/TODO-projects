import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { FondoProyecto } from "./FondoProyecto";

const IMAGEN_A = "11111111-1111-4111-8111-111111111111";
const IMAGEN_B = "22222222-2222-4222-8222-222222222222";

/** Devuelve el color tal y como lo normaliza el DOM (hex → rgb). */
function rgb(hex: string): string {
  const valor = hex.replace("#", "");
  const r = parseInt(valor.slice(0, 2), 16);
  const g = parseInt(valor.slice(2, 4), 16);
  const b = parseInt(valor.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function capa(container: HTMLElement): HTMLElement {
  const elemento = container.querySelector<HTMLElement>(".fondo-proyecto__capa");
  if (!elemento) throw new Error("No hay capa de imagen");
  return elemento;
}

function visibilidad(valor: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: valor });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("FondoProyecto", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("pinta el degradado del ambiente con las curvas de nivel", () => {
    const { container } = render(<FondoProyecto fondo={{ tipo: "ambiente", ambiente: "coral" }} />);

    const fondo = container.querySelector(".fondo-proyecto");
    expect(fondo?.className).toContain("fondo-proyecto--coral");
    expect(container.querySelector(".fondo-proyecto__velo")).toBeNull();

    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 1200 800");
    expect(container.querySelectorAll("path")).toHaveLength(10);
  });

  it("usa el color liso con las mismas curvas de nivel", () => {
    const { container } = render(<FondoProyecto fondo={{ tipo: "color", color: "#123456" }} />);

    const fondo = container.querySelector<HTMLElement>(".fondo-proyecto");
    expect(fondo?.classList.contains("fondo-proyecto--liso")).toBe(true);
    expect(fondo?.style.backgroundColor).toBe(rgb("#123456"));
    expect(container.querySelectorAll("path")).toHaveLength(10);
  });

  it("añade un velo cuando el color liso es claro y no cuando es oscuro", () => {
    const claro = render(<FondoProyecto fondo={{ tipo: "color", color: "#ffffff" }} />);
    expect(claro.container.querySelector(".fondo-proyecto__velo")).toBeTruthy();
    claro.unmount();

    const oscuro = render(<FondoProyecto fondo={{ tipo: "color", color: "#202020" }} />);
    expect(oscuro.container.querySelector(".fondo-proyecto__velo")).toBeNull();
  });

  it("con una imagen la deja fija, sin temporizador", () => {
    const intervalo = vi.spyOn(window, "setInterval");
    const { container } = render(
      <FondoProyecto fondo={{ tipo: "imagenes", ids: [IMAGEN_A], intervaloSeg: 30 }} />,
    );

    expect(container.querySelector(".fondo-proyecto--imagenes")).toBeTruthy();
    expect(capa(container).style.backgroundImage).toContain(IMAGEN_A);
    expect(container.querySelector(".fondo-proyecto__capa--anterior")).toBeNull();
    expect(container.querySelector(".fondo-proyecto__velo")).toBeTruthy();
    expect(intervalo).not.toHaveBeenCalled();
  });

  it("rota las imágenes cada intervalo con un fundido cruzado", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FondoProyecto fondo={{ tipo: "imagenes", ids: [IMAGEN_A, IMAGEN_B], intervaloSeg: 10 }} />,
    );

    expect(capa(container).style.backgroundImage).toContain(IMAGEN_A);

    act(() => vi.advanceTimersByTime(10_000));
    expect(capa(container).style.backgroundImage).toContain(IMAGEN_B);
    const anterior = container.querySelector<HTMLElement>(
      ".fondo-proyecto__capa--anterior",
    );
    expect(anterior?.style.backgroundImage).toContain(IMAGEN_A);
    expect(anterior?.getAttribute("aria-hidden")).toBe("true");

    act(() => vi.advanceTimersByTime(1_200));
    expect(container.querySelector(".fondo-proyecto__capa--anterior")).toBeNull();
  });

  it("con prefers-reduced-motion cambia sin fundido", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.useFakeTimers();

    const { container } = render(
      <FondoProyecto fondo={{ tipo: "imagenes", ids: [IMAGEN_A, IMAGEN_B], intervaloSeg: 10 }} />,
    );

    act(() => vi.advanceTimersByTime(10_000));
    expect(capa(container).style.backgroundImage).toContain(IMAGEN_B);
    expect(container.querySelector(".fondo-proyecto__capa--anterior")).toBeNull();
  });

  it("se pausa con la pestaña oculta y se reanuda al volver", () => {
    vi.useFakeTimers();
    const { container } = render(
      <FondoProyecto fondo={{ tipo: "imagenes", ids: [IMAGEN_A, IMAGEN_B], intervaloSeg: 10 }} />,
    );

    act(() => vi.advanceTimersByTime(10_000));
    expect(capa(container).style.backgroundImage).toContain(IMAGEN_B);

    act(() => visibilidad("hidden"));
    act(() => vi.advanceTimersByTime(20_000));
    expect(capa(container).style.backgroundImage).toContain(IMAGEN_B);

    act(() => visibilidad("visible"));
    act(() => vi.advanceTimersByTime(10_000));
    expect(capa(container).style.backgroundImage).toContain(IMAGEN_A);
  });

  it("descarta los ids que no son uuid y cae a bosque sin imágenes válidas", () => {
    const mezcla = render(
      <FondoProyecto
        fondo={{ tipo: "imagenes", ids: ["no-es-uuid", IMAGEN_A], intervaloSeg: 30 }}
      />,
    );

    expect(mezcla.container.querySelectorAll(".fondo-proyecto__capa")).toHaveLength(1);
    expect(capa(mezcla.container).style.backgroundImage).toContain(IMAGEN_A);
    expect(mezcla.container.innerHTML).not.toContain("no-es-uuid");
    mezcla.unmount();

    const sinValidas = render(
      <FondoProyecto fondo={{ tipo: "imagenes", ids: ["no-es-uuid"], intervaloSeg: 30 }} />,
    );
    expect(sinValidas.container.querySelector(".fondo-proyecto--bosque")).toBeTruthy();
    expect(sinValidas.container.querySelector(".fondo-proyecto__capa")).toBeNull();
  });

  it("recurre al ambiente bosque sin fondo", () => {
    const { container } = render(<FondoProyecto fondo={null} />);
    expect(container.querySelector(".fondo-proyecto--bosque")).toBeTruthy();
  });
});
