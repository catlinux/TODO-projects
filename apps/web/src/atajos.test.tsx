import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { useAtajos, type AccionesAtajos } from "./atajos";

function Arnes(acciones: AccionesAtajos) {
  useAtajos(acciones);
  return (
    <div>
      <input aria-label="Campo" />
      <textarea aria-label="Área" />
      <button type="button">Botón</button>
    </div>
  );
}

function acciones(): AccionesAtajos {
  return {
    onBuscar: vi.fn(),
    onNuevaTarea: vi.fn(),
    onHoy: vi.fn(),
    onAgenda: vi.fn(),
    onAyuda: vi.fn(),
  };
}

/** Añade un `<dialog open>` para simular un modal abierto. */
function abrirDialogoModal(): HTMLDialogElement {
  const dialogo = document.createElement("dialog");
  dialogo.setAttribute("open", "");
  document.body.appendChild(dialogo);
  return dialogo;
}

describe("useAtajos", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("abre la paleta con Ctrl+K y con ⌘+K", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });

    expect(espia.onBuscar).toHaveBeenCalledTimes(2);
  });

  it("no abre la paleta si ya hay un diálogo modal", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);
    const dialogo = abrirDialogoModal();

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(espia.onBuscar).not.toHaveBeenCalled();

    dialogo.remove();
  });

  it("«N» abre una tarea nueva fuera de campos, pero no dentro", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);

    fireEvent.keyDown(document.body, { key: "n" });
    expect(espia.onNuevaTarea).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("Campo"), { key: "n" });
    fireEvent.keyDown(screen.getByLabelText("Área"), { key: "n" });
    expect(espia.onNuevaTarea).toHaveBeenCalledTimes(1);
  });

  it("«G» seguido de «H» va a Hoy y «G» «A» a la Agenda", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);

    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "h" });
    expect(espia.onHoy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "a" });
    expect(espia.onAgenda).toHaveBeenCalledTimes(1);
  });

  it("una «G» sola no navega", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);

    fireEvent.keyDown(document.body, { key: "g" });

    expect(espia.onHoy).not.toHaveBeenCalled();
    expect(espia.onAgenda).not.toHaveBeenCalled();
  });

  it("«?» abre la ayuda fuera de campos, pero no dentro", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);

    fireEvent.keyDown(document.body, { key: "?" });
    expect(espia.onAyuda).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("Campo"), { key: "?" });
    expect(espia.onAyuda).toHaveBeenCalledTimes(1);
  });

  it("no intercepta combinaciones con Ctrl, Alt o Meta", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);

    fireEvent.keyDown(document.body, { key: "n", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "g", altKey: true });
    fireEvent.keyDown(document.body, { key: "a", metaKey: true });

    expect(espia.onNuevaTarea).not.toHaveBeenCalled();
    expect(espia.onAgenda).not.toHaveBeenCalled();
  });

  it("ignora los atajos si hay un diálogo modal abierto", () => {
    const espia = acciones();
    render(<Arnes {...espia} />);
    const dialogo = abrirDialogoModal();

    fireEvent.keyDown(document.body, { key: "n" });
    fireEvent.keyDown(document.body, { key: "g" });
    fireEvent.keyDown(document.body, { key: "h" });

    expect(espia.onNuevaTarea).not.toHaveBeenCalled();
    expect(espia.onHoy).not.toHaveBeenCalled();

    dialogo.remove();
  });
});
