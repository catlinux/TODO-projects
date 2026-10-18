/** Símbolo por defecto cuando el nombre no aporta letra ni dígito. */
export const INICIAL_POR_DEFECTO = "•";

/**
 * Primera letra o dígito del nombre, en mayúscula, ignorando signos, espacios
 * y cualquier otro símbolo inicial (p. ej. «[Prueba] Viaje» → «P»). Devuelve
 * el símbolo por defecto si no hay ninguno.
 */
export function inicial(nombre: string): string {
  const encontrado = nombre.match(/[\p{L}\p{Nd}]/u);
  return encontrado ? encontrado[0].toLocaleUpperCase("es-ES") : INICIAL_POR_DEFECTO;
}
