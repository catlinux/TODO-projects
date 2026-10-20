import { describe, expect, it } from "vitest";

import {
  MAX_CARACTERES_ADJUNTO,
  MAX_CARACTERES_CHAT_ASISTENTE,
  componerPeticion,
  componerTextoMensaje,
  contarCaracteres,
  esArchivoDeTexto,
  esBinario,
  leerAdjunto,
  type AdjuntoChat,
  type ArchivoTexto,
} from "./adjuntos-chat";

function archivo(nombre: string, contenido: string, tipo = "text/plain"): ArchivoTexto {
  return {
    name: nombre,
    type: tipo,
    size: contenido.length,
    text: async () => contenido,
  };
}

function adjunto(id: string, contenido: string): AdjuntoChat {
  return { id, nombre: `${id}.md`, tamano: contenido.length, contenido };
}

describe("adjuntos del chat", () => {
  it("acepta archivos de texto por extensión o por tipo MIME", () => {
    expect(esArchivoDeTexto({ name: "notas.md", type: "" })).toBe(true);
    expect(esArchivoDeTexto({ name: "datos", type: "text/plain" })).toBe(true);
    expect(esArchivoDeTexto({ name: "foto.png", type: "image/png" })).toBe(false);
    expect(esArchivoDeTexto({ name: "sin-extension", type: "" })).toBe(false);
  });

  it("lee un archivo de texto y devuelve sus datos", async () => {
    const resultado = await leerAdjunto(archivo("notas.md", "# Título\ncontenido"));
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.adjunto.nombre).toBe("notas.md");
    expect(resultado.adjunto.contenido).toBe("# Título\ncontenido");
    expect(resultado.adjunto.id).toMatch(/^adj-/);
  });

  it("rechaza un tipo no admitido", async () => {
    const resultado = await leerAdjunto(archivo("foto.png", "datos", "image/png"));
    expect(resultado).toEqual({ ok: false, motivo: "tipo" });
  });

  it("detecta binarios por caracteres nulos o no imprimibles", async () => {
    expect(esBinario("texto normal\ncon saltos")).toBe(false);
    expect(esBinario("texto\u0000con nulo")).toBe(true);
    expect(esBinario("\u0001\u0002\u0003\u0004")).toBe(true);

    const resultado = await leerAdjunto(archivo("datos.txt", "a\u0000b"));
    expect(resultado).toEqual({ ok: false, motivo: "binario" });
  });

  it("rechaza un archivo de más de 100 000 caracteres sin truncarlo", async () => {
    const contenido = "a".repeat(MAX_CARACTERES_ADJUNTO + 1);
    const resultado = await leerAdjunto(archivo("grande.txt", contenido));
    expect(resultado).toEqual({ ok: false, motivo: "grande" });
  });

  it("compone el texto con delimitadores después de la instrucción", () => {
    const texto = componerTextoMensaje("Convierte esto en tareas", [adjunto("a", "# Notas\nhola")]);
    expect(texto).toBe(
      "Convierte esto en tareas\n\n[Archivo adjunto: a.md]\n# Notas\nhola\n[Fin del archivo]",
    );
    expect(contarCaracteres("Convierte esto en tareas", [adjunto("a", "# Notas\nhola")])).toBe(
      texto.length,
    );
  });

  it("marca los adjuntos sin contenido disponible", () => {
    const texto = componerTextoMensaje("Hola", [{ ...adjunto("a", "x"), omitido: true }]);
    expect(texto).toContain("[Archivo adjunto: a.md — contenido omitido para ahorrar espacio]");
  });

  it("recorta los adjuntos más antiguos al superar el total y conserva el último", () => {
    const mensajes = [
      { rol: "user" as const, texto: "Primero", adjuntos: [adjunto("a", "x".repeat(100_000))] },
      { rol: "user" as const, texto: "Segundo", adjuntos: [adjunto("b", "y".repeat(100_000))] },
      { rol: "user" as const, texto: "Tercero", adjuntos: [adjunto("c", "z".repeat(100_000))] },
    ];

    const { mensajes: preparados, total, omitidos } = componerPeticion(mensajes);

    expect(omitidos).toEqual(["a"]);
    expect(total).toBeLessThanOrEqual(MAX_CARACTERES_CHAT_ASISTENTE);
    expect(preparados[0]!.texto).toContain(
      "[Archivo adjunto: a.md — contenido omitido para ahorrar espacio]",
    );
    expect(preparados[1]!.texto).toContain("y".repeat(50));
    expect(preparados[2]!.texto).toContain("z".repeat(50));
  });

  it("nunca recorta el contenido del último mensaje", () => {
    const mensajes = [
      { rol: "user" as const, texto: "Primero", adjuntos: [adjunto("a", "x".repeat(100_000))] },
      { rol: "user" as const, texto: "Segundo", adjuntos: [adjunto("b", "y".repeat(100_000))] },
      { rol: "user" as const, texto: "Último", adjuntos: [adjunto("c", "z".repeat(100_000))] },
    ];

    const { mensajes: preparados, omitidos } = componerPeticion(mensajes, 150_000);

    expect(omitidos).toEqual(["a", "b"]);
    expect(preparados[2]!.texto).toContain("z".repeat(100_000));
  });
});
