import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
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
  columnasCompactas: [] as string[],
  onAlternarColumnaCompacta: vi.fn(),
  anulacionesTarjeta: {} as Record<string, boolean>,
  onAlternarTarjetaCompacta: vi.fn(),
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
  function RutaActual() {
    const ruta = useLocation();
    return <span data-testid="ruta-actual">{ruta.pathname}</span>;
  }

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

  it("pinta una portada suave en todas las tarjetas, aunque falte o sea inválida", () => {
    usarTablero();

    const conColor = screen.getByText("Tarea inicial").closest("li");
    const portadaColor = conColor?.querySelector<HTMLElement>(".tarjeta-kanban__portada");
    expect(portadaColor?.getAttribute("style")).toContain("color-mix");

    const sinImagen = screen.getByText("Otra").closest("li");
    const portadaSinImagen = sinImagen?.querySelector<HTMLElement>(".tarjeta-kanban__portada");
    expect(portadaSinImagen).not.toBeNull();
    expect(portadaSinImagen?.className).not.toContain("tarjeta-kanban__portada--imagen");
    expect(portadaSinImagen?.getAttribute("style")).toContain("color-mix");
  });

  it("pone el título dentro de la portada y enlaza desde ella", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, portada: null }], []);

    const enlace = screen.getByRole("link", { name: /tarea inicial/i });
    const portada = enlace.closest(".tarjeta-kanban__portada");
    expect(portada).not.toBeNull();
    expect(enlace.getAttribute("id")).toBe("tarjeta-t1");
    expect(portada?.querySelector(".tarjeta-kanban__titulo")?.textContent).toBe("Tarea inicial");
  });

  function renderConEtiquetas(
    tareas: TareaApi[],
    etiquetas: EtiquetaApi[],
    opciones: {
      compactas?: string[];
      onAlternar?: (columnaId: string) => void;
      anulaciones?: Record<string, boolean>;
      onAlternarTarjeta?: (tareaId: string) => void;
    } = {},
  ) {
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    cliente.setQueryData(["tareas", "p1"], tareas);
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <RutaActual />
          <Tablero
            proyectoId="p1"
            columnas={columnas}
            tareas={tareas}
            etiquetas={etiquetas}
            {...accionesColumnas}
            columnasCompactas={opciones.compactas ?? []}
            onAlternarColumnaCompacta={opciones.onAlternar ?? accionesColumnas.onAlternarColumnaCompacta}
            anulacionesTarjeta={opciones.anulaciones ?? {}}
            onAlternarTarjetaCompacta={
              opciones.onAlternarTarjeta ?? accionesColumnas.onAlternarTarjetaCompacta
            }
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
    expect(tarjeta?.querySelectorAll(".tarjeta-kanban__etiquetas .etiqueta")).toHaveLength(2);
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

  it("muestra los cuatro primeros elementos y un botón «+N más»", () => {
    renderConEtiquetas(
      [
        {
          ...tareasIniciales[0]!,
          checklist: {
            hechos: 1,
            total: 6,
            items: [
              { id: "e1", texto: "Primero", hecho: false, tieneDescripcion: false },
              { id: "e2", texto: "Segundo", hecho: true, tieneDescripcion: false },
              { id: "e3", texto: "Tercero", hecho: false, tieneDescripcion: false },
              { id: "e4", texto: "Cuarto", hecho: false, tieneDescripcion: false },
              { id: "e5", texto: "Quinto", hecho: false, tieneDescripcion: false },
              { id: "e6", texto: "Sexto", hecho: false, tieneDescripcion: false },
            ],
          },
        },
      ],
      [],
    );

    const tarjeta = screen.getByText("Tarea inicial").closest("li");
    expect(tarjeta?.querySelectorAll(".tarjeta-kanban__checklist-item")).toHaveLength(4);
    expect(tarjeta?.querySelector(".tarjeta-kanban__checklist-item--hecho")?.textContent).toBe(
      "Segundo",
    );
    // El elemento hecho conserva su casilla marcada.
    expect((screen.getByRole("checkbox", { name: "Segundo" }) as HTMLInputElement).checked).toBe(
      true,
    );

    const mas = screen.getByRole("button", { name: "+2 más" });
    expect(mas.getAttribute("aria-expanded")).toBe("false");
    expect((mas as HTMLButtonElement).closest("a")).toBeNull();
  });

  it("«+N más» despliega todo el checklist sin abrir la tarjeta y «Ver menos» lo pliega", async () => {
    const user = userEvent.setup();
    renderConEtiquetas(
      [
        {
          ...tareasIniciales[0]!,
          checklist: {
            hechos: 0,
            total: 6,
            items: [
              { id: "e1", texto: "Primero", hecho: false, tieneDescripcion: false },
              { id: "e2", texto: "Segundo", hecho: false, tieneDescripcion: false },
              { id: "e3", texto: "Tercero", hecho: false, tieneDescripcion: false },
              { id: "e4", texto: "Cuarto", hecho: false, tieneDescripcion: false },
              { id: "e5", texto: "Quinto", hecho: false, tieneDescripcion: false },
              { id: "e6", texto: "Sexto", hecho: false, tieneDescripcion: false },
            ],
          },
        },
      ],
      [],
    );

    const tarjeta = () => screen.getByText("Tarea inicial").closest("li");
    const boton = screen.getByRole("button", { name: "+2 más" });
    await user.click(boton);

    expect(screen.queryByText("Quinto")).toBeTruthy();
    expect(screen.queryByText("Sexto")).toBeTruthy();
    expect(tarjeta()?.querySelectorAll(".tarjeta-kanban__checklist-item")).toHaveLength(6);
    // No navega ni abre la tarjeta ni su menú.
    expect(screen.getByTestId("ruta-actual").textContent).toBe("/");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();

    const menos = screen.getByRole("button", { name: "Ver menos" });
    expect(menos.getAttribute("aria-expanded")).toBe("true");
    await user.click(menos);

    expect(screen.queryByText("Quinto")).toBeNull();
    expect(tarjeta()?.querySelectorAll(".tarjeta-kanban__checklist-item")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "+2 más" })).toBeTruthy();
  });

  it("marcar un elemento llama a la API con el valor correcto", async () => {
    const user = userEvent.setup();
    const peticiones: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        peticiones.push({
          url,
          method: String(init?.method ?? "GET").toUpperCase(),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderConEtiquetas(
      [
        {
          ...tareasIniciales[0]!,
          checklist: {
            hechos: 0,
            total: 1,
            items: [{ id: "e1", texto: "Primero", hecho: false, tieneDescripcion: false }],
          },
        },
      ],
      [],
    );

    await user.click(screen.getByRole("checkbox", { name: "Primero" }));

    await waitFor(() => {
      expect(peticiones).toContainEqual({
        url: "/api/checklist/e1",
        method: "PATCH",
        body: { hecho: true },
      });
    });
    // La casilla es lo único que marca; no abre el diálogo.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pulsar el texto abre el diálogo y no marca ni navega", async () => {
    const user = userEvent.setup();
    const peticiones: Array<{ url: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET").toUpperCase();
        peticiones.push({ url, method });
        if (url === "/api/tareas/t1/checklist" && method === "GET") {
          return new Response(
            JSON.stringify([
              {
                id: "e1",
                tareaId: "t1",
                texto: "Primero",
                descripcion: "Detalle largo del primer paso.",
                hecho: false,
                posicion: 0,
                createdAt: "",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    renderConEtiquetas(
      [
        {
          ...tareasIniciales[0]!,
          checklist: {
            hechos: 0,
            total: 1,
            items: [{ id: "e1", texto: "Primero", hecho: false, tieneDescripcion: true }],
          },
        },
      ],
      [],
    );

    await user.click(screen.getByRole("button", { name: "Abrir «Primero»" }));

    expect(await screen.findByRole("dialog", { name: /elemento del checklist/i })).toBeTruthy();
    expect((screen.getByLabelText(/^descripción$/i) as HTMLTextAreaElement).value).toBe(
      "Detalle largo del primer paso.",
    );
    // El texto no está dentro del enlace de la tarjeta ni cambia de ruta.
    expect(screen.getByTestId("ruta-actual").textContent).toBe("/");
    expect(peticiones.some((peticion) => peticion.method === "PATCH")).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Primero" }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("muestra el icono de descripción solo en los elementos que la tienen", () => {
    renderConEtiquetas(
      [
        {
          ...tareasIniciales[0]!,
          checklist: {
            hechos: 0,
            total: 2,
            items: [
              { id: "e1", texto: "Primero", hecho: false, tieneDescripcion: true },
              { id: "e2", texto: "Segundo", hecho: false, tieneDescripcion: false },
            ],
          },
        },
      ],
      [],
    );

    expect(
      screen.getByRole("button", { name: "Abrir «Primero»" }).querySelector(
        ".checklist__icono-descripcion",
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Abrir «Segundo»" }).querySelector(
        ".checklist__icono-descripcion",
      ),
    ).toBeNull();
    expect(screen.getAllByRole("img", { name: "Tiene descripción" })).toHaveLength(1);
  });

  it("no pinta la lista del checklist si la tarea no tiene elementos", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, checklist: { hechos: 0, total: 0 } }], []);

    expect(
      screen.getByText("Tarea inicial").closest("li")?.querySelector(".tarjeta-kanban__checklist"),
    ).toBeNull();
  });

  it("muestra la insignia de comentarios si la tarea tiene", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, comentarios: 3 }], []);

    const insignia = screen
      .getByText("Tarea inicial")
      .closest("li")
      ?.querySelector(".tarjeta-kanban__insignia--comentarios");
    expect(insignia?.textContent).toContain("3");
  });

  it("no pinta la insignia de comentarios si no hay ninguno", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, comentarios: 0 }], []);

    expect(
      screen
        .getByText("Tarea inicial")
        .closest("li")
        ?.querySelector(".tarjeta-kanban__insignia--comentarios"),
    ).toBeNull();
  });

  it("pinta la portada de imagen cuando el id es un uuid", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    renderConEtiquetas(
      [{ ...tareasIniciales[0]!, portada: { tipo: "imagen", archivoId: uuid } }],
      [],
    );

    const portada = screen
      .getByText("Tarea inicial")
      .closest("li")
      ?.querySelector<HTMLElement>(".tarjeta-kanban__portada--imagen");
    expect(portada).not.toBeNull();
    const imagen = portada?.querySelector("img");
    expect(imagen?.getAttribute("src")).toContain(`/api/archivos/${uuid}`);
  });

  it("cae a la portada automática si la imagen falla al cargar", () => {
    const uuid = "11111111-1111-1111-1111-111111111111";
    renderConEtiquetas(
      [{ ...tareasIniciales[0]!, portada: { tipo: "imagen", archivoId: uuid } }],
      [],
    );

    const imagen = document.querySelector<HTMLImageElement>(".tarjeta-kanban__imagen");
    expect(imagen).not.toBeNull();
    fireEvent.error(imagen!);

    const portada = screen
      .getByText("Tarea inicial")
      .closest("li")
      ?.querySelector<HTMLElement>(".tarjeta-kanban__portada");
    expect(portada?.querySelector(".tarjeta-kanban__imagen")).toBeNull();
    expect(portada?.className).not.toContain("tarjeta-kanban__portada--imagen");
    expect(portada?.getAttribute("style")).toContain("color-mix");
  });

  it("usa la portada automática si la imagen no tiene un id válido", () => {
    renderConEtiquetas(
      [{ ...tareasIniciales[0]!, portada: { tipo: "imagen", archivoId: "a1" } }],
      [],
    );

    const portada = screen
      .getByText("Tarea inicial")
      .closest("li")
      ?.querySelector<HTMLElement>(".tarjeta-kanban__portada");
    expect(portada).not.toBeNull();
    expect(portada?.className).not.toContain("tarjeta-kanban__portada--imagen");
    expect(portada?.getAttribute("style")).toContain("color-mix");
  });

  it("muestra la insignia de adjuntos si la tarea tiene", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, adjuntos: 2 }], []);

    const insignia = screen
      .getByText("Tarea inicial")
      .closest("li")
      ?.querySelector(".tarjeta-kanban__insignia--adjuntos");
    expect(insignia?.textContent).toContain("2");
  });

  it("no pinta la insignia de adjuntos si no hay ninguno", () => {
    renderConEtiquetas([{ ...tareasIniciales[0]!, adjuntos: 0 }], []);

    expect(
      screen.getByText("Tarea inicial").closest("li")?.querySelector(".tarjeta-kanban__insignia--adjuntos"),
    ).toBeNull();
  });

  it("contrae una columna con el botón de la cabecera y lo anuncia con aria-expanded", async () => {
    const user = userEvent.setup();
    const onAlternar = vi.fn();
    renderConEtiquetas(tareasIniciales, [], { onAlternar });

    const boton = screen.getByRole("button", { name: /contraer columna pendiente/i });
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    await user.click(boton);

    expect(onAlternar).toHaveBeenCalledWith("c1");
    expect(accionesColumnas.onAlternarColumnaCompacta).not.toHaveBeenCalled();
  });

  it("en vista compacta deja solo el título, los mandos y el indicador del checklist", () => {
    renderConEtiquetas(
      [{ ...tareasIniciales[0]!, checklist: { hechos: 1, total: 3 } }, tareasIniciales[1]!],
      [],
      { compactas: ["c1"] },
    );

    const compacta = screen.getByText("Tarea inicial").closest("li")!;
    expect(compacta.className).toContain("tarjeta-kanban--compacta");
    expect(compacta.querySelector(".tarjeta-kanban__portada")).toBeNull();
    expect(compacta.querySelector(".tarjeta-kanban__pie")).toBeNull();
    expect(compacta.querySelector(".tarjeta-kanban__etiquetas")).toBeNull();
    expect(compacta.querySelector(".tarjeta-kanban__insignia")?.textContent).toBe("1/3");

    // El título compacto sigue enlazando a la tarjeta y muestra el título completo.
    const enlace = screen.getByRole("link", { name: "Tarea inicial" });
    expect(enlace.getAttribute("href")).toBe("/proyectos/p1/tareas/t1");
    expect(enlace.getAttribute("title")).toBe("Tarea inicial");
    expect(within(compacta).getByRole("button", { name: /arrastrar tarea/i })).toBeTruthy();
    expect(
      within(compacta).getByRole("button", { name: /opciones de la tarjeta tarea inicial/i }),
    ).toBeTruthy();

    const ancho = screen.getByRole("button", { name: /expandir columna pendiente/i });
    expect(ancho.getAttribute("aria-expanded")).toBe("false");

    // La otra columna sigue con las tarjetas completas.
    expect(
      screen.getByText("Otra").closest("li")?.querySelector(".tarjeta-kanban__portada"),
    ).not.toBeNull();
  });

  it("contrae una tarjeta con su flecha sin abrirla ni abrir el menú", async () => {
    const user = userEvent.setup();
    renderConEtiquetas(tareasIniciales, []);

    const boton = screen.getByRole("button", { name: /contraer tarjeta tarea inicial/i });
    expect(boton.getAttribute("aria-expanded")).toBe("true");
    await user.click(boton);

    expect(accionesColumnas.onAlternarTarjetaCompacta).toHaveBeenCalledWith("t1");
    expect(screen.getByTestId("ruta-actual").textContent).toBe("/");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("una anulación individual contrae solo esa tarjeta", () => {
    renderConEtiquetas(
      [
        { ...tareasIniciales[0]!, columnaId: "c1", posicion: 0 },
        { ...tareasIniciales[1]!, columnaId: "c1", posicion: 1 },
      ],
      [],
      { anulaciones: { t1: true } },
    );

    const contraida = screen.getByText("Tarea inicial").closest("li")!;
    expect(contraida.className).toContain("tarjeta-kanban--compacta");
    expect(contraida.querySelector(".tarjeta-kanban__portada")).toBeNull();
    expect(
      screen.getByText("Otra").closest("li")?.querySelector(".tarjeta-kanban__portada"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /expandir tarjeta tarea inicial/i }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");
  });

  it("permite expandir una tarjeta dentro de una columna compacta", async () => {
    const user = userEvent.setup();
    const onAlternarTarjeta = vi.fn();
    renderConEtiquetas(
      [
        { ...tareasIniciales[0]!, columnaId: "c1", posicion: 0 },
        { ...tareasIniciales[1]!, columnaId: "c1", posicion: 1 },
      ],
      [],
      { compactas: ["c1"], onAlternarTarjeta },
    );

    await user.click(screen.getByRole("button", { name: /expandir tarjeta tarea inicial/i }));

    expect(onAlternarTarjeta).toHaveBeenCalledWith("t1");
    // La otra tarjeta de la misma columna sigue compacta.
    expect(screen.getByText("Otra").closest("li")?.className).toContain(
      "tarjeta-kanban--compacta",
    );
  });
});