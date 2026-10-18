import { readFileSync } from "node:fs";

/** Versión del proyecto, leída del archivo `VERSION` de la raíz del repositorio. */
export const VERSION: string = (() => {
  try {
    return readFileSync(new URL("../../../VERSION", import.meta.url), "utf8").trim();
  } catch {
    return "desconocida";
  }
})();
