import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export interface PropiedadesAyudaAtajos {
  abierto: boolean;
  onCerrar: () => void;
}

function IconoCerrar() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

/** Diálogo con la lista de atajos de teclado (se abre con «?»). */
export function AyudaAtajos({ abierto, onCerrar }: PropiedadesAyudaAtajos) {
  const { t } = useTranslation();
  const refDialogo = useRef<HTMLDialogElement>(null);
  const refFocoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (abierto) {
      refFocoAnterior.current = document.activeElement as HTMLElement | null;
      if (typeof dialogo.showModal === "function") {
        if (!dialogo.open) dialogo.showModal();
      } else {
        dialogo.setAttribute("open", "");
      }
      dialogo.querySelector<HTMLElement>("button")?.focus();
    } else {
      if (typeof dialogo.close === "function") {
        if (dialogo.open) dialogo.close();
      } else {
        dialogo.removeAttribute("open");
      }
      refFocoAnterior.current?.focus();
      refFocoAnterior.current = null;
    }
  }, [abierto]);

  const filas = [
    { id: "buscar", texto: t("shortcuts.search") },
    { id: "nueva-tarea", texto: t("shortcuts.newTask") },
    { id: "hoy", texto: t("shortcuts.today") },
    { id: "agenda", texto: t("shortcuts.agenda") },
    { id: "ayuda", texto: t("shortcuts.help") },
    { id: "cerrar", texto: t("shortcuts.escape") },
  ];

  return (
    <dialog
      ref={refDialogo}
      className="dialogo-tarea ayuda-atajos"
      aria-labelledby="titulo-ayuda-atajos"
      onCancel={(evento) => {
        evento.preventDefault();
        onCerrar();
      }}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          onCerrar();
        }
      }}
    >
      {abierto && (
        <div className="dialogo-tarea__cuerpo">
          <div className="dialogo-tarea__cabecera">
            <h2 id="titulo-ayuda-atajos">{t("shortcuts.title")}</h2>
            <button
              type="button"
              className="dialogo-tarea__cerrar"
              aria-label={t("tasks.closeDialog")}
              onClick={onCerrar}
            >
              <IconoCerrar />
            </button>
          </div>
          <ul className="ayuda-atajos__lista" aria-label={t("shortcuts.title")}>
            {filas.map((fila) => (
              <li key={fila.id} className="ayuda-atajos__fila">
                {fila.texto}
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}
