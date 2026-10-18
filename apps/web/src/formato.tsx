import type { ReactNode } from "react";

/**
 * Mini-formato propio de las descripciones: párrafos, `**negrita**`,
 * `*cursiva*`, `` `código` `` y enlaces `[texto](https://…)`. No genera HTML:
 * todo se convierte a nodos React, así que cualquier etiqueta del texto se
 * muestra como texto.
 */

/** Contador de claves por llamada; evita claves repetidas entre nodos hermanos. */
interface Contador {
  n: number;
}

function nuevaClave(contador: Contador): string {
  contador.n += 1;
  return `formato-${contador.n}`;
}

const RE_ENLACE = /^https?:\/\//i;
const RE_ITEM_NO_ORDENADO = /^-\s+/;
const RE_ITEM_ORDENADO = /^\d+\.\s+/;

function nodosEnLinea(texto: string, contador: Contador): ReactNode[] {
  const nodos: ReactNode[] = [];
  let plano = "";
  let i = 0;

  function volcarPlano() {
    if (plano) {
      nodos.push(plano);
      plano = "";
    }
  }

  while (i < texto.length) {
    const caracter = texto[i]!;

    if (caracter === "`") {
      const fin = texto.indexOf("`", i + 1);
      if (fin > i + 1) {
        volcarPlano();
        nodos.push(<code key={nuevaClave(contador)}>{texto.slice(i + 1, fin)}</code>);
        i = fin + 1;
        continue;
      }
    }

    if (texto.startsWith("**", i)) {
      const fin = texto.indexOf("**", i + 2);
      if (fin > i + 2) {
        volcarPlano();
        nodos.push(
          <strong key={nuevaClave(contador)}>
            {nodosEnLinea(texto.slice(i + 2, fin), contador)}
          </strong>,
        );
        i = fin + 2;
        continue;
      }
    }

    if (caracter === "*") {
      const fin = texto.indexOf("*", i + 1);
      if (fin > i + 1) {
        volcarPlano();
        nodos.push(
          <em key={nuevaClave(contador)}>{nodosEnLinea(texto.slice(i + 1, fin), contador)}</em>,
        );
        i = fin + 1;
        continue;
      }
    }

    if (caracter === "[") {
      const cierreTexto = texto.indexOf("]", i + 1);
      if (cierreTexto > i + 1 && texto[cierreTexto + 1] === "(") {
        const cierreUrl = texto.indexOf(")", cierreTexto + 2);
        if (cierreUrl > cierreTexto + 2) {
          const url = texto.slice(cierreTexto + 2, cierreUrl);
          // Solo http/https: javascript: y demás esquemas se quedan como texto.
          if (RE_ENLACE.test(url)) {
            volcarPlano();
            nodos.push(
              <a
                key={nuevaClave(contador)}
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {nodosEnLinea(texto.slice(i + 1, cierreTexto), contador)}
              </a>,
            );
            i = cierreUrl + 1;
            continue;
          }
        }
      }
    }

    plano += caracter;
    i += 1;
  }

  volcarPlano();
  return nodos;
}

function bloqueLista(lineas: string[]): boolean {
  return lineas.every(
    (linea) => RE_ITEM_NO_ORDENADO.test(linea) || RE_ITEM_ORDENADO.test(linea),
  );
}

export function formatearTexto(texto: string): ReactNode {
  if (!texto || !texto.trim()) {
    return null;
  }

  const contador: Contador = { n: 0 };
  const bloques = texto
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((bloque) => bloque.replace(/\s+$/, ""))
    .filter((bloque) => bloque.trim().length > 0);

  return bloques.map((bloque) => {
    const lineas = bloque.split("\n");

    if (bloqueLista(lineas)) {
      const ordenada = RE_ITEM_ORDENADO.test(lineas[0]!);
      const items = lineas.map((linea) =>
        linea.replace(RE_ITEM_NO_ORDENADO, "").replace(RE_ITEM_ORDENADO, ""),
      );
      const contenido = items.map((item) => (
        <li key={nuevaClave(contador)}>{nodosEnLinea(item, contador)}</li>
      ));

      return ordenada ? (
        <ol key={nuevaClave(contador)} className="formato__lista">
          {contenido}
        </ol>
      ) : (
        <ul key={nuevaClave(contador)} className="formato__lista">
          {contenido}
        </ul>
      );
    }

    const contenido: ReactNode[] = [];
    lineas.forEach((linea, indice) => {
      if (indice > 0) {
        contenido.push(<br key={nuevaClave(contador)} />);
      }
      contenido.push(...nodosEnLinea(linea, contador));
    });

    return (
      <p key={nuevaClave(contador)} className="formato__parrafo">
        {contenido}
      </p>
    );
  });
}
