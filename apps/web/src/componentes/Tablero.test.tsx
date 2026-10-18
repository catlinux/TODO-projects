import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
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

const accionesColumnas = {
  onCrearColumna: vi.fn(),
  onRenombrarColumna: vi.fn(),
  onMoverColumna: vi.fn(),
  onEliminarColumna: vi.fn(),
};

function WrapperDePrueba({ onRef }: FichaProps) {
  const ref = useRef<ControlTablero>(null);
  useEffect(() => onRef(ref), [onRef]);
  return (
    <Tablero
      ref={ref}
      proyectoId="p1"
      columnas={columnas}
      tareas={tareasIniciales}
      {...accionesColumnas}
    />
  );
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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

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

  it("abre el menú de una columna y permite moverla y eliminarla", async () => {
    const user = userEvent.setup();
    usarTablero();

    const boton = screen.getByRole("button", { name: /opciones de la columna pendiente/i });
    expect(boton.getAttribute("aria-expanded")).toBe("false");

    await user.click(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    expect(
      (screen.getByRole("menuitem", { name: /mover a la izquierda/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("menuitem", { name: /mover a la derecha/i }));
    expect(accionesColumnas.onMoverColumna).toHaveBeenCalledWith("c1", 1);

    await user.click(screen.getByRole("button", { name: /opciones de la columna en curso/i }));
    await user.click(screen.getByRole("menuitem", { name: /eliminar columna/i }));
    expect(accionesColumnas.onEliminarColumna).toHaveBeenCalledWith("c2");
  });
});
