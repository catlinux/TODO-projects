import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "../i18n/index";
import { type ColumnaApi, type EtiquetaApi, type TareaApi } from "../api";
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
    portada: { tipo: "color", valor: "#6e4fe6" },
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "t2",
    proyectoId: "p1",
    columnaId: "c2",
    titulo: "Otra",
    posicion: 0,
    portada: { tipo: "imagen", archivoId: "a1" },
    createdAt: "",
    updatedAt: "",
  },
];

interface FichaProps {
  onRef: (ref: { current: ControlTablero | null }) => void;
}

const accionesColumnas = {
  onCrearTarea: vi.fn(),
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
      <MemoryRouter>
        <WrapperDePrueba
          onRef={(r) => {
            ref = r;
          }}
        />
      </MemoryRouter>
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

  it("el cuerpo de la tarjeta enlaza a su ruta", () => {
    usarTablero();

    const enlace = screen.getByRole("link", { name: /tarea inicial/i });
    expect(enlace.getAttribute("href")).toBe("/proyectos/p1/tareas/t1");
    expect(enlace.getAttribute("id")).toBe("tarjeta-t1");
  });

  it("abre el menú de una tarjeta y permite editar, mover y eliminar", async () => {
    const user = userEvent.setup();
    const peticiones: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        if (url === "/api/tareas/t1" && (method === "PATCH" || method === "DELETE")) {
          peticiones.push({
            url,
            method,
            body: init?.body ? JSON.parse(String(init.body)) : null,
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    usarTablero();

    const boton = screen.getByRole("button", { name: /opciones de la tarjeta tarea inicial/i });
    expect(boton.getAttribute("aria-expanded")).toBe("false");

    await user.click(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    // Editar abre la ruta de la tarjeta, no una edición en línea.
    expect(
      screen.getByRole("menuitem", { name: /^editar$/i }).getAttribute("href"),
    ).toBe("/proyectos/p1/tareas/t1");
    expect(screen.getByRole("menuitem", { name: /mover a/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^eliminar$/i })).toBeTruthy();

    // Mover a… abre la lista de columnas y mueve la tarea.
    await user.click(screen.getByRole("menuitem", { name: /mover a/i }));
    await user.click(screen.getByRole("menuitem", { name: /^en curso$/i }));
    await waitFor(() => {
      expect(peticiones).toContainEqual({
        url: "/api/tareas/t1",
        method: "PATCH",
        body: { columnaId: "c2" },
      });
    });

    // Eliminar ejecuta el DELETE.
    await user.click(screen.getByRole("button", { name: /opciones de la tarjeta tarea inicial/i }));
    await user.click(screen.getByRole("menuitem", { name: /^eliminar$/i }));
    await waitFor(() => {
      expect(peticiones).toContainEqual({ url: "/api/tareas/t1", method: "DELETE", body: null });
    });
  });

  it("cierra el menú de la tarjeta con Esc y devuelve el foco", async () => {
    const user = userEvent.setup();
    usarTablero();

    const boton = screen.getByRole("button", { name: /opciones de la tarjeta tarea inicial/i });
    await user.click(boton);
    expect(boton.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    expect(boton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(boton);
  });

  it("crea una tarjeta con Intro y deja el campo abierto y vacío", async () => {
    const user = userEvent.setup();
    usarTablero();

    await user.click(screen.getAllByRole("button", { name: /añadir tarjeta/i })[0]!);
    const campo = screen.getByRole("textbox", { name: /título de la tarjeta/i });
    await user.type(campo, "Nueva tarjeta{Enter}");

    expect(accionesColumnas.onCrearTarea).toHaveBeenCalledWith("c1", "Nueva tarjeta");
    const siguen = screen.getByRole("textbox", { name: /título de la tarjeta/i });
    expect((siguen as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(siguen);
  });

  it("no crea una tarjeta con el título vacío y cierra con Esc", async () => {
    const user = userEvent.setup();
    usarTablero();

    await user.click(screen.getAllByRole("button", { name: /añadir tarjeta/i })[0]!);
    const campo = screen.getByRole("textbox", { name: /título de la tarjeta/i });
    await user.type(campo, "{Enter}");
    expect(accionesColumnas.onCrearTarea).not.toHaveBeenCalled();

    await user.type(campo, "Sin guardar{Escape}");
    expect(screen.queryByRole("textbox", { name: /título de la tarjeta/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /añadir tarjeta/i })).toHaveLength(2);
    expect(accionesColumnas.onCrearTarea).not.toHaveBeenCalled();
  });

  it("marca como hecha la tarjeta de la última columna", () => {
    usarTablero();

    const hecha = screen.getByText("Otra").closest("li");
    expect(hecha?.className).toContain("tarjeta-kanban--hecha");
    const pendiente = screen.getByText("Tarea inicial").closest("li");
    expect(pendiente?.className).not.toContain("tarjeta-kanban--hecha");
  });

  it("pinta la portada de color e ignora la de imagen", () => {
    usarTablero();

    const conColor = screen.getByText("Tarea inicial").closest("li");
    expect(conColor?.querySelector(".tarjeta-kanban__portada")).not.toBeNull();
    const conImagen = screen.getByText("Otra").closest("li");
    expect(conImagen?.querySelector(".tarjeta-kanban__portada")).toBeNull();
  });

  function renderConEtiquetas(tareas: TareaApi[], etiquetas: EtiquetaApi[]) {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cliente.setQueryData(["tareas", "p1"], tareas);
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <Tablero
            proyectoId="p1"
            columnas={columnas}
            tareas={tareas}
            etiquetas={etiquetas}
            {...accionesColumnas}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("pinta las etiquetas de la tarjeta y la insignia del checklist", () => {
    const etiquetas: EtiquetaApi[] = [
      { id: "e1", proyectoId: "p1", nombre: "Casa", color: "#6E4FE6", createdAt: "", updatedAt: "" },
      { id: "e2", proyectoId: "p1", nombre: "Urgente", color: "#C8303A", createdAt: "", updatedAt: "" },
    ];
    renderConEtiquetas(
      [
        {
          ...tareasIniciales[0]!,
          etiquetas: ["e1", "e2"],
          checklist: { hechos: 1, total: 3 },
        },
      ],
      etiquetas,
    );

    const tarjeta = screen.getByText("Tarea inicial").closest("li");
    expect(tarjeta?.querySelectorAll(".tarjeta-kanban__etiquetas .pastilla-etiqueta")).toHaveLength(2);
    expect(tarjeta?.querySelector(".tarjeta-kanban__insignia")?.textContent).toBe("1/3");
    expect(tarjeta?.querySelector(".tarjeta-kanban__insignia--hecha")).toBeNull();
  });

  it("marca la insignia como hecha cuando el checklist está completo", () => {
    renderConEtiquetas(
      [{ ...tareasIniciales[0]!, checklist: { hechos: 2, total: 2 } }],
      [],
    );

    const insignia = screen
      .getByText("Tarea inicial")
      .closest("li")
      ?.querySelector(".tarjeta-kanban__insignia--hecha");
    expect(insignia?.textContent).toBe("2/2");
  });

  it("no pinta insignia si el checklist está vacío", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, checklist: { hechos: 0, total: 0 } }], []);

    expect(screen.getByText("Tarea inicial").closest("li")?.querySelector(".tarjeta-kanban__insignia")).toBeNull();
  });
});
