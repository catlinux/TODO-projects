/**
 * Conversor mínimo de Markdown para las respuestas del asistente: párrafos,
 * títulos, listas y código. Todo se escribe como nodos de React, así que el
 * HTML que llegue del modelo se muestra como texto y nunca se interpreta.
 */

import { type ReactNode } from "react";

export type Bloque =
  | { tipo: "parrafo"; lineas: string[] }
  | { tipo: "titulo"; nivel: number; texto: string }
  | { tipo: "lista"; ordenada: boolean; elementos: string[] }
  | { tipo: "codigo"; lenguaje: string; lineas: string[] };

const RE_TITULO = /^(#{1,6})\s+(.*)$/;
const RE_VINETA = /^[-*+]\s+(.*)$/;
const RE_NUMERO = /^\d+[.)]\s+(.*)$/;
const RE_EN_LINEA = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function esCercaDeCodigo(linea: string): boolean {
  return linea.trim().startsWith("```");
}

function esPrincipioDeBloque(linea: string): boolean {
  return (
    !linea.trim() ||
    esCercaDeCodigo(linea) ||
    RE_TITULO.test(linea) ||
    RE_VINETA.test(linea) ||
    RE_NUMERO.test(linea)
  );
}

export function analizarTexto(texto: string): Bloque[] {
  const lineas = texto.replace(/\r\n?/g, "\n").split("\n");
  const bloques: Bloque[] = [];
  let i = 0;

  while (i < lineas.length) {
    const linea = lineas[i]!;

    if (esCercaDeCodigo(linea)) {
      const lenguaje = linea.trim().slice(3).trim();
      const codigo: string[] = [];
      i += 1;
      while (i < lineas.length && !esCercaDeCodigo(lineas[i]!)) {
        codigo.push(lineas[i]!);
        i += 1;
      }
      i += 1;
      bloques.push({ tipo: "codigo", lenguaje, lineas: codigo });
      continue;
    }

    if (!linea.trim()) {
      i += 1;
      continue;
    }

    const titulo = RE_TITULO.exec(linea);
    if (titulo) {
      bloques.push({ tipo: "titulo", nivel: titulo[1]!.length, texto: titulo[2]! });
      i += 1;
      continue;
    }

    if (RE_VINETA.test(linea) || RE_NUMERO.test(linea)) {
      const ordenada = RE_NUMERO.test(linea);
      const patron = ordenada ? RE_NUMERO : RE_VINETA;
      const elementos: string[] = [];
      let coincide = patron.exec(lineas[i]!);
      while (coincide) {
        elementos.push(coincide[1]!);
        i += 1;
        coincide = i < lineas.length ? patron.exec(lineas[i]!) : null;
      }
      bloques.push({ tipo: "lista", ordenada, elementos });
      continue;
    }

    const parrafo: string[] = [];
    while (i < lineas.length && !esPrincipioDeBloque(lineas[i]!)) {
      parrafo.push(lineas[i]!);
      i += 1;
    }
    bloques.push({ tipo: "parrafo", lineas: parrafo });
  }

  return bloques;
}

/** Negrita, cursiva y código en línea; el resto se deja como texto literal. */
function formatearEnLinea(texto: string): ReactNode[] {
  return texto.split(RE_EN_LINEA).map((parte, indice) => {
    if (parte.length > 4 && parte.startsWith("**") && parte.endsWith("**")) {
      return <strong key={indice}>{parte.slice(2, -2)}</strong>;
    }
    if (parte.length > 2 && parte.startsWith("`") && parte.endsWith("`")) {
      return <code key={indice}>{parte.slice(1, -1)}</code>;
    }
    if (
      parte.length > 2 &&
      ((parte.startsWith("*") && parte.endsWith("*")) ||
        (parte.startsWith("_") && parte.endsWith("_")))
    ) {
      return <em key={indice}>{parte.slice(1, -1)}</em>;
    }
    return parte;
  });
}

export function TextoAsistente({ texto }: { texto: string }) {
  return (
    <div className="asistente__texto">
      {analizarTexto(texto).map((bloque, indice) => {
        if (bloque.tipo === "titulo") {
          const Etiqueta = `h${Math.min(bloque.nivel + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
          return <Etiqueta key={indice}>{formatearEnLinea(bloque.texto)}</Etiqueta>;
        }
        if (bloque.tipo === "codigo") {
          return (
            <pre key={indice} className="asistente__codigo">
              <code>{bloque.lineas.join("\n")}</code>
            </pre>
          );
        }
        if (bloque.tipo === "lista") {
          const Lista = bloque.ordenada ? "ol" : "ul";
          return (
            <Lista key={indice} className="asistente__lista">
              {bloque.elementos.map((elemento, posicion) => (
                <li key={posicion}>{formatearEnLinea(elemento)}</li>
              ))}
            </Lista>
          );
        }
        return (
          <p key={indice}>
            {bloque.lineas.map((linea, posicion) => (
              <span key={posicion}>
                {posicion > 0 && <br />}
                {formatearEnLinea(linea)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
