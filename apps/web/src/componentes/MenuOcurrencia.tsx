import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion, type OcurrenciaAgenda } from "../api";
import { aIsoUtc, aValorLocal } from "../recurrencia-web";

interface Propiedades {
  ocurrencia: OcurrenciaAgenda;
}

/**
 * Menú «⋯» de una ocurrencia recurrente: mover solo esta, omitirla o
 * restaurarla. Actúa sobre la ocurrencia (PUT/DELETE con `fechaOriginal`), no
 * sobre la serie completa.
 */
export function MenuOcurrencia({ ocurrencia }: Propiedades) {
  const { t } = useTranslation();
  const cliente = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  const [nuevaFecha, setNuevaFecha] = useState(() => aValorLocal(ocurrencia.fecha));
  const refDialogo = useRef<HTMLDialogElement>(null);
  const refContenedor = useRef<HTMLDivElement>(null);

  const invalidar = async () => {
    await cliente.invalidateQueries({ queryKey: ["agenda"] });
    await cliente.invalidateQueries({ queryKey: ["tareas"] });
  };

  const guardarExcepcion = useMutation({
    mutationFn: (cuerpo: { fechaNueva?: string; omitida?: boolean }) =>
      peticion(`/tareas/${ocurrencia.tareaId}/excepciones`, {
        method: "PUT",
        body: JSON.stringify({ fechaOriginal: ocurrencia.fechaOriginal, ...cuerpo }),
      }),
    onSuccess: invalidar,
  });

  const restaurar = useMutation({
    mutationFn: () =>
      peticion(
        `/tareas/${ocurrencia.tareaId}/excepciones?fechaOriginal=${encodeURIComponent(
          ocurrencia.fechaOriginal,
        )}`,
        { method: "DELETE" },
      ),
    onSuccess: invalidar,
  });

  useEffect(() => {
    const dialogo = refDialogo.current;
    if (!dialogo) return;
    if (dialogoAbierto) {
      if (typeof dialogo.showModal === "function") {
        if (!dialogo.open) dialogo.showModal();
      } else {
        dialogo.setAttribute("open", "");
      }
      dialogo.querySelector<HTMLElement>("input, button")?.focus();
    } else if (typeof dialogo.close === "function") {
      if (dialogo.open) dialogo.close();
    } else {
      dialogo.removeAttribute("open");
    }
  }, [dialogoAbierto]);

  // Cierra el menú al hacer clic fuera o al pasar el foco a otro sitio.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (evento: PointerEvent) => {
      if (!refContenedor.current?.contains(evento.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener("pointerdown", alPulsar);
    return () => document.removeEventListener("pointerdown", alPulsar);
  }, [abierto]);

  const error = guardarExcepcion.isError || restaurar.isError;

  const abrirMovimiento = () => {
    setNuevaFecha(aValorLocal(ocurrencia.fecha));
    setAbierto(false);
    setDialogoAbierto(true);
  };

  return (
    <div
      className="menu-ocurrencia__contenedor"
      ref={refContenedor}
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.stopPropagation();
          setAbierto(false);
        }
      }}
    >
      <button
        type="button"
        className="boton-icono menu-ocurrencia__boton"
        aria-label={t("occurrence.options", { titulo: ocurrencia.titulo })}
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto((valor) => !valor)}
      >
        ⋯
      </button>

      {abierto && (
        <div className="menu-ocurrencia" role="menu" aria-label={t("occurrence.options", { titulo: ocurrencia.titulo })}>
          <button type="button" role="menuitem" onClick={abrirMovimiento}>
            {t("occurrence.move")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAbierto(false);
              guardarExcepcion.mutate({ omitida: true });
            }}
          >
            {t("occurrence.omit")}
          </button>
          {ocurrencia.conExcepcion && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setAbierto(false);
                restaurar.mutate();
              }}
            >
              {t("occurrence.restore")}
            </button>
          )}
          {error && <p className="error menu-ocurrencia__error">{t("auth.error")}</p>}
        </div>
      )}

      <dialog
        ref={refDialogo}
        className="dialogo dialogo--ocurrencia"
        aria-labelledby={`ocurrencia-titulo-${ocurrencia.tareaId}-${ocurrencia.fechaOriginal}`}
        onCancel={(evento) => {
          evento.preventDefault();
          setDialogoAbierto(false);
        }}
        onKeyDown={(evento) => {
          if (evento.key === "Escape") {
            evento.preventDefault();
            evento.stopPropagation();
            setDialogoAbierto(false);
          }
        }}
      >
        {dialogoAbierto && (
          <div className="dialogo__cuerpo">
            <div className="dialogo__cabecera">
              <h2 id={`ocurrencia-titulo-${ocurrencia.tareaId}-${ocurrencia.fechaOriginal}`}>
                {t("occurrence.moveTitle")}
              </h2>
            </div>
            <form
              className="formulario"
              onSubmit={(evento) => {
                evento.preventDefault();
                const fechaNueva = aIsoUtc(nuevaFecha);
                if (!fechaNueva) return;
                setDialogoAbierto(false);
                guardarExcepcion.mutate({ fechaNueva });
              }}
            >
              <label>
                {t("occurrence.moveDate")}
                <input
                  type="datetime-local"
                  value={nuevaFecha}
                  onChange={(evento) => setNuevaFecha(evento.target.value)}
                  required
                />
              </label>
              <div className="dialogo__pie">
                <button
                  type="button"
                  className="boton-fantasma"
                  onClick={() => setDialogoAbierto(false)}
                >
                  {t("tasks.cancel")}
                </button>
                <button type="submit" className="boton-principal" disabled={guardarExcepcion.isPending}>
                  {t("occurrence.moveConfirm")}
                </button>
              </div>
            </form>
          </div>
        )}
      </dialog>
    </div>
  );
}
