import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TextoAsistente, analizarTexto } from "./markdown";

describe("TextoAsistente", () => {
  afterEach(() => {
    cleanup();
  });

  it("separa títulos, párrafos, listas y bloques de código", () => {
    const bloques = analizarTexto(
      "# Título\n\nUn párrafo\ncon dos líneas.\n\n- uno\n- dos\n\n1. primero\n2. segundo\n\n```ts\nconst x = 1;\n```",
    );
    expect(bloques[0]).toMatchObject({ tipo: "titulo", nivel: 1, texto: "Título" });
    expect(bloques[1]).toMatchObject({ tipo: "parrafo", lineas: ["Un párrafo", "con dos líneas."] });
    expect(bloques[2]).toMatchObject({ tipo: "lista", ordenada: false, elementos: ["uno", "dos"] });
    expect(bloques[3]).toMatchObject({
      tipo: "lista",
      ordenada: true,
      elementos: ["primero", "segundo"],
    });
    expect(bloques[4]).toMatchObject({
      tipo: "codigo",
      lenguaje: "ts",
      lineas: ["const x = 1;"],
    });
  });

  it("escapa el HTML del modelo en vez de interpretarlo", () => {
    render(<TextoAsistente texto={'<script>alert("x")</script>\n\n<b>negrita</b>'} />);
    expect(screen.getByText('<script>alert("x")</script>')).toBeTruthy();
    expect(screen.getByText("<b>negrita</b>")).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });

  it("aplica negrita, cursiva y código en línea", () => {
    render(<TextoAsistente texto={"**fuerte** y *cursiva* con `codigo`"} />);
    expect(screen.getByText("fuerte").tagName).toBe("STRONG");
    expect(screen.getByText("cursiva").tagName).toBe("EM");
    expect(screen.getByText("codigo").tagName).toBe("CODE");
  });
});
