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
    { id: "buscar", teclas: t("shortcuts.search.teclas"), texto: t("shortcuts.search.texto") },
    { id: "nueva-tarea", teclas: t("shortcuts.newTask.teclas"), texto: t("shortcuts.newTask.texto") },
    { id: "hoy", teclas: t("shortcuts.today.teclas"), texto: t("shortcuts.today.texto") },
    { id: "bandeja", teclas: t("shortcuts.inbox.teclas"), texto: t("shortcuts.inbox.texto") },
    { id: "agenda", teclas: t("shortcuts.agenda.teclas"), texto: t("shortcuts.agenda.texto") },
    {
      id: "asistente",
      teclas: t("shortcuts.assistant.teclas"),
      texto: t("shortcuts.assistant.texto"),
    },
    { id: "ayuda", teclas: t("shortcuts.help.teclas"), texto: t("shortcuts.help.texto") },
    { id: "cerrar", teclas: t("shortcuts.escape.teclas"), texto: t("shortcuts.escape.texto") },
  ];

  return (
    <dialog
      ref={refDialogo}
      className="dialogo ayuda-atajos"
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
        <div className="dialogo__cuerpo">
          <div className="dialogo__cabecera">
            <h2 id="titulo-ayuda-atajos">{t("shortcuts.title")}</h2>
            <button
              type="button"
              className="boton-icono"
              aria-label={t("tasks.closeDialog")}
              onClick={onCerrar}
            >
              <IconoCerrar />
            </button>
          </div>
          <table className="ayuda-atajos__tabla">
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.id}>
                  <th scope="row">
                    <kbd>{fila.teclas}</kbd>
                  </th>
                  <td>{fila.texto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </dialog>
  );
}
