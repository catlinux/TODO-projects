import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { formatearTexto } from "./formato";

function pintar(texto: string) {
  const { container } = render(<div>{formatearTexto(texto)}</div>);
  return container;
}

describe("formatearTexto", () => {
  afterEach(() => cleanup());

  it("separa párrafos por línea en blanco y saltos simples con <br>", () => {
    const container = pintar("Primer párrafo\ncon salto\n\nSegundo párrafo");

    const parrafos = container.querySelectorAll("p.formato__parrafo");
    expect(parrafos).toHaveLength(2);
    expect(parrafos[0]?.querySelector("br")).not.toBeNull();
    expect(parrafos[0]?.textContent).toBe("Primer párrafocon salto");
    expect(parrafos[1]?.textContent).toBe("Segundo párrafo");
  });

  it("convierte negrita, cursiva y código en sus nodos", () => {
    const container = pintar("**fuerte** y *suave* con `código`");

    expect(container.querySelector("strong")?.textContent).toBe("fuerte");
    expect(container.querySelector("em")?.textContent).toBe("suave");
    expect(container.querySelector("code")?.textContent).toBe("código");
  });

  it("convierte listas con «- » y «1. »", () => {
    const container = pintar("- uno\n- dos\n\n1. primero\n2. segundo");

    const listas = container.querySelectorAll("ul.formato__lista, ol.formato__lista");
    expect(listas).toHaveLength(2);
    expect(container.querySelectorAll("ul.formato__lista li")).toHaveLength(2);
    expect(container.querySelectorAll("ol.formato__lista li")).toHaveLength(2);
    expect(container.querySelector("ol.formato__lista li")?.textContent).toBe("primero");
  });

  it("crea enlaces http/https con target y rel seguros", () => {
    const container = pintar("Mira [este enlace](https://example.com/x) y otro [http](http://a.test)");

    const enlaces = container.querySelectorAll("a");
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0]?.getAttribute("href")).toBe("https://example.com/x");
    expect(enlaces[0]?.getAttribute("target")).toBe("_blank");
    expect(enlaces[0]?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(enlaces[0]?.textContent).toBe("este enlace");
  });

  it("no enlaza esquemas peligrosos y los deja como texto", () => {
    const container = pintar("[pulsa](javascript:alert(1))");

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("[pulsa](javascript:alert(1))");
  });

  it("muestra el HTML del texto como texto, sin interpretarlo", () => {
    const container = pintar("<b>hola</b>");

    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>hola</b>");
  });

  it("deja los marcadores sin cerrar como texto plano", () => {
    const negrita = pintar("**sin cerrar");
    expect(negrita.querySelector("strong")).toBeNull();
    expect(negrita.textContent).toBe("**sin cerrar");

    const cursiva = pintar("*cursiva suelta");
    expect(cursiva.querySelector("em")).toBeNull();
    expect(cursiva.textContent).toBe("*cursiva suelta");
  });

  it("devuelve nada con texto vacío o solo espacios", () => {
    expect(formatearTexto("")).toBeNull();
    expect(formatearTexto("   \n  ")).toBeNull();
    expect(pintar("   \n  ").textContent).toBe("");
  });
});
