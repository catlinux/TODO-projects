import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { type ColumnaApi, type TareaApi } from "../api";
import { Tablero, type ControlTablero } from "./Tablero";

const columnas: ColumnaApi[] = [
  { id: "c1", proyectoId: "p1", nombre: "Pendiente", posicion: 0, createdAt: "", updatedAt: "" },
  { id: "c2", proyectoId: "p1", nombre: "En curso", posicion: 1, createdAt: "", updatedAt: "" },
];

const tareasIniciales: TareaApi[] = [
  {
    id: "t1",
    proyectoId: "p1",
    columnaId: "c1",
    titulo: "Tarea inicial",
    posicion: 0,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "t2",
    proyectoId: "p1",
    columnaId: "c2",
    titulo: "Otra",
    posicion: 0,
    createdAt: "",
    updatedAt: "",
  },
];

interface FichaProps {
  onRef: (ref: { current: ControlTablero | null }) => void;
}

function WrapperDePrueba({ onRef }: FichaProps) {
  const ref = useRef<ControlTablero>(null);
  useEffect(() => onRef(ref), [onRef]);
  return <Tablero ref={ref} proyectoId="p1" columnas={columnas} tareas={tareasIniciales} />;
}

function usarTablero() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(["tareas", "p1"], tareasIniciales);
  let ref: { current: ControlTablero | null } = { current: null };
  render(
    <QueryClientProvider client={cliente}>
      <WrapperDePrueba
        onRef={(r) => {
          ref = r;
        }}
      />
    </QueryClientProvider>,
  );
  return { cliente, ref };
}

describe("Tablero", () => {
  afterEach(() => vi.restoreAllMocks());

  it("envía el PATCH y actualiza la caché al soltar", async () => {
    const cuerpo: { body: unknown } = { body: undefined };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/tareas/t1" && String(init?.method ?? "GET").toUpperCase() === "PATCH") {
          cuerpo.body = init?.body;
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { cliente, ref } = usarTablero();
    const promesa = ref.current!.gestionarFinArrastre({
      active: { id: "t1", data: { current: { titulo: "Tarea inicial" } } },
      over: { id: "c2" },
    } as unknown as Parameters<ControlTablero["gestionarFinArrastre"]>[0]);

    await waitFor(() => {
      const cuerpoParseado = JSON.parse(String(cuerpo.body));
      expect(cuerpoParseado.columnaId).toBe("c2");
      expect(
        cliente.getQueryData<TareaApi[]>(["tareas", "p1"])?.find((t) => t.id === "t1")?.columnaId,
      ).toBe("c2");
    });

    await promesa;
  });

  it("revierte la caché si el PATCH falla", async () => {
    let llamadaPatch = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/tareas/t1" && String(init?.method ?? "GET").toUpperCase() === "PATCH") {
          llamadaPatch = true;
          return new Response(JSON.stringify({ mensaje: "fallo" }), {
            status: 409,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const { cliente, ref } = usarTablero();
    await expect(
      ref.current!.gestionarFinArrastre({
        active: { id: "t1", data: { current: { titulo: "Tarea inicial" } } },
        over: { id: "c2" },
      } as unknown as Parameters<ControlTablero["gestionarFinArrastre"]>[0]),
    ).resolves.toBeUndefined();

    expect(llamadaPatch).toBe(true);
    expect(
      cliente.getQueryData<TareaApi[]>(["tareas", "p1"])?.find((t) => t.id === "t1")?.columnaId,
    ).toBe("c1");
  });
});
