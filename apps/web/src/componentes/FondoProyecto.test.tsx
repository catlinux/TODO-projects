import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { FondoProyecto } from "./FondoProyecto";

/** Devuelve el color tal y como lo normaliza el DOM (hex → rgb). */
function rgb(hex: string): string {
  const valor = hex.replace("#", "");
  const r = parseInt(valor.slice(0, 2), 16);
  const g = parseInt(valor.slice(2, 4), 16);
  const b = parseInt(valor.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe("FondoProyecto", () => {
  afterEach(() => {
    cleanup();
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

  it("recurre al ambiente bosque con imágenes y sin fondo", () => {
    const imagenes = render(
      <FondoProyecto
        fondo={{ tipo: "imagenes", ids: ["11111111-1111-4111-8111-111111111111"], intervaloSeg: 30 }}
      />,
    );
    expect(imagenes.container.querySelector(".fondo-proyecto--bosque")).toBeTruthy();
    imagenes.unmount();

    const sinFondo = render(<FondoProyecto fondo={null} />);
    expect(sinFondo.container.querySelector(".fondo-proyecto--bosque")).toBeTruthy();
  });
});
