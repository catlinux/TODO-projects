import { useEffect, useRef } from "react";

/** Acciones que disparan los atajos globales. */
export interface AccionesAtajos {
  /** Ctrl/⌘+K: abre la paleta de búsqueda. */
  onBuscar: () => void;
  /** «N»: nueva tarea en el proyecto abierto (si lo hay). */
  onNuevaTarea: () => void;
  /** «G» seguido de «H»: ir a Hoy. */
  onHoy: () => void;
  /** «G» seguido de «B»: ir a la Bandeja de entrada. */
  onBandeja: () => void;
  /** «G» seguido de «A»: ir a la Agenda. */
  onAgenda: () => void;
  /** «?»: abrir la ayuda de atajos. */
  onAyuda: () => void;
}

const ETIQUETAS_EDITABLES = ["INPUT", "TEXTAREA", "SELECT"];

/** Milisegundos que se recuerda la «G» a la espera de la segunda tecla. */
const ESPERA_G_MS = 1000;

function enCampoEditable(elemento: EventTarget | null): boolean {
  if (!(elemento instanceof HTMLElement)) return false;
  if (ETIQUETAS_EDITABLES.includes(elemento.tagName)) return true;
  return elemento.isContentEditable;
}

/** ¿Hay un `<dialog>` modal abierto? (la paleta o cualquier tarjeta). */
function hayDialogoModal(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/**
 * Atajos de teclado globales. Se monta una vez en `Disposicion`: salvo «?» y
 * Ctrl/⌘+K, solo actúan fuera de campos de texto y sin diálogos modales abiertos.
 */
export function useAtajos(acciones: AccionesAtajos): void {
  const refAcciones = useRef(acciones);
  refAcciones.current = acciones;

  useEffect(() => {
    let marcaG = 0;
    let temporizadorG: number | undefined;

    const olvidarG = () => {
      marcaG = 0;
      if (temporizadorG !== undefined) {
        window.clearTimeout(temporizadorG);
        temporizadorG = undefined;
      }
    };

    const alPulsar = (evento: KeyboardEvent) => {
      const actuales = refAcciones.current;

      // Ctrl/⌘+K abre la paleta desde cualquier pantalla protegida.
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "k") {
        evento.preventDefault();
        if (!hayDialogoModal()) actuales.onBuscar();
        return;
      }

      // El resto de atajos no se mezclan con Ctrl, Alt ni Meta.
      if (evento.ctrlKey || evento.altKey || evento.metaKey) return;

      if (enCampoEditable(evento.target)) return;

      // «?» abre la ayuda aunque haya un diálogo modal abierto.
      if (evento.key === "?") {
        evento.preventDefault();
        actuales.onAyuda();
        return;
      }

      if (hayDialogoModal()) return;

      const tecla = evento.key.toLowerCase();

      if (tecla === "n") {
        evento.preventDefault();
        actuales.onNuevaTarea();
        return;
      }

      if (tecla === "g") {
        olvidarG();
        marcaG = Date.now();
        temporizadorG = window.setTimeout(olvidarG, ESPERA_G_MS);
        return;
      }

      if (marcaG !== 0 && Date.now() - marcaG < ESPERA_G_MS) {
        if (tecla === "h") {
          evento.preventDefault();
          olvidarG();
          actuales.onHoy();
        } else if (tecla === "b") {
          evento.preventDefault();
          olvidarG();
          actuales.onBandeja();
        } else if (tecla === "a") {
          evento.preventDefault();
          olvidarG();
          actuales.onAgenda();
        }
      }
    };

    window.addEventListener("keydown", alPulsar);
    return () => {
      window.removeEventListener("keydown", alPulsar);
      olvidarG();
    };
  }, []);
}
