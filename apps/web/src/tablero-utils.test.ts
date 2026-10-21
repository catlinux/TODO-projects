import { describe, expect, it } from "vitest";

import {
  alternarAnulacionTarjeta,
  borrarAnulacionesTarjeta,
  estaTarjetaContraida,
  limpiarAnulacionesTarjeta,
  moverTareaEnLista,
  type TareaTablero,
} from "./tablero-utils";

function tarea(id: string, columnaId: string, posicion: number): TareaTablero {
  return {
    id,
    proyectoId: "p1",
    columnaId,
    titulo: id,
    descripcion: null,
    posicion,
    createdAt: "",
    updatedAt: "",
  };
}

describe("moverTareaEnLista", () => {
  it("reordena hacia arriba dentro de la misma columna", () => {
    const tareas = [tarea("a", "c1", 0), tarea("b", "c1", 1), tarea("c", "c1", 2)];
    const salida = moverTareaEnLista(tareas, "c", "c1", 0);
    expect(salida.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(salida.map((t) => t.posicion)).toEqual([0, 1, 2]);
    expect(salida.every((t) => t.columnaId === "c1")).toBe(true);
  });

  it("reordena hacia abajo dentro de la misma columna", () => {
    const tareas = [tarea("a", "c1", 0), tarea("b", "c1", 1), tarea("c", "c1", 2)];
    const salida = moverTareaEnLista(tareas, "a", "c1", 2);
    expect(salida.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(salida.map((t) => t.posicion)).toEqual([0, 1, 2]);
  });

  it("mueve entre columnas al final", () => {
    const tareas = [tarea("a", "c1", 0), tarea("b", "c1", 1), tarea("x", "c2", 0)];
    const salida = moverTareaEnLista(tareas, "b", "c2", 2);
    expect(salida.filter((t) => t.columnaId === "c1").map((t) => t.id)).toEqual(["a"]);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.id)).toEqual(["x", "b"]);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.posicion)).toEqual([0, 1]);
    expect(salida.filter((t) => t.columnaId === "c1").map((t) => t.posicion)).toEqual([0]);
  });

  it("mueve a una columna vacía", () => {
    const tareas = [tarea("a", "c1", 0)];
    const salida = moverTareaEnLista(tareas, "a", "c2", 0);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.id)).toEqual(["a"]);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.posicion)).toEqual([0]);
    expect(salida.filter((t) => t.columnaId === "c1")).toHaveLength(0);
  });

  it("mueve al principio de otra columna", () => {
    const tareas = [tarea("a", "c1", 0), tarea("x", "c2", 0), tarea("y", "c2", 1)];
    const salida = moverTareaEnLista(tareas, "a", "c2", 0);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.id)).toEqual(["a", "x", "y"]);
  });

  it("ajusta el índice si está fuera de rango por exceso", () => {
    const tareas = [tarea("a", "c1", 0), tarea("b", "c2", 0)];
    const salida = moverTareaEnLista(tareas, "a", "c2", 99);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("ajusta el índice si es negativo", () => {
    const tareas = [tarea("a", "c1", 0), tarea("b", "c2", 0)];
    const salida = moverTareaEnLista(tareas, "a", "c2", -5);
    expect(salida.filter((t) => t.columnaId === "c2").map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("devuelve una copia sin cambios si la tarea no existe", () => {
    const tareas = [tarea("a", "c1", 0)];
    const salida = moverTareaEnLista(tareas, "inexistente", "c2", 0);
    expect(salida).toEqual(tareas);
    expect(salida).not.toBe(tareas);
  });
});

describe("estado compacto de las tarjetas", () => {
  it("sin anulación hereda el estado de la columna", () => {
    expect(estaTarjetaContraida("t1", true, {})).toBe(true);
    expect(estaTarjetaContraida("t1", false, {})).toBe(false);
  });

  it("la anulación individual prevalece sobre la columna", () => {
    expect(estaTarjetaContraida("t1", false, { t1: true })).toBe(true);
    expect(estaTarjetaContraida("t1", true, { t1: false })).toBe(false);
  });

  it("contraer una tarjeta abierta crea la anulación", () => {
    expect(alternarAnulacionTarjeta({}, "t1", false)).toEqual({ t1: true });
  });

  it("expandir una tarjeta compacta crea la anulación", () => {
    expect(alternarAnulacionTarjeta({}, "t1", true)).toEqual({ t1: false });
  });

  it("al volver al estado de la columna borra la anulación sobrante", () => {
    expect(alternarAnulacionTarjeta({ t1: true }, "t1", false)).toEqual({});
    expect(alternarAnulacionTarjeta({ t1: false }, "t1", true)).toEqual({});
  });

  it("alternar una tarjeta no toca las anulaciones de las demás", () => {
    expect(alternarAnulacionTarjeta({ t2: false }, "t1", false)).toEqual({
      t2: false,
      t1: true,
    });
  });

  it("borra solo las anulaciones de las tareas indicadas", () => {
    const anulaciones = { t1: true, t2: false, t3: true };
    expect(borrarAnulacionesTarjeta(anulaciones, ["t1", "t3"])).toEqual({ t2: false });
  });

  it("devuelve el mismo objeto si no hay anulaciones que borrar", () => {
    const anulaciones = { t1: true };
    expect(borrarAnulacionesTarjeta(anulaciones, ["t2"])).toBe(anulaciones);
  });

  it("limpia los ids que ya no existen", () => {
    expect(limpiarAnulacionesTarjeta({ t1: true, t2: false }, ["t1"])).toEqual({ t1: true });
  });

  it("no cambia el objeto si todas las anulaciones siguen existiendo", () => {
    const anulaciones = { t1: true };
    expect(limpiarAnulacionesTarjeta(anulaciones, ["t1", "t2"])).toBe(anulaciones);
  });
});
