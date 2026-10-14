import { describe, expect, it } from "vitest";

import { moverTareaEnLista, type TareaTablero } from "./tablero-utils";

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
