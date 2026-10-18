import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  IDIOMAS_VOZ,
  esIdiomaVoz,
  guardarEnvioAutomatico,
  guardarIdiomaVoz,
  leerEnvioAutomatico,
  leerIdiomaVoz,
  soportaVoz,
  useReconocimientoVoz,
  type IdiomaVoz,
} from "../voz";

interface PropiedadesBotonVoz {
  /** Texto que hay ahora en el cuadro de mensaje. */
  texto: string;
  /** Sustituye el contenido del cuadro de mensaje. */
  alCambiarTexto: (texto: string) => void;
  /** Envía el mensaje con el texto indicado (auto-envío al terminar de hablar). */
  alEnviar: (texto: string) => void;
  /** El asistente está respondiendo: el dictado se desactiva. */
  deshabilitado?: boolean;
}

/** Añade un fragmento al texto previo separándolos con un solo espacio. */
function unir(previo: string, nuevo: string): string {
  const izquierda = previo.replace(/\s+$/, "");
  const derecha = nuevo.trim();
  if (!izquierda) return derecha;
  if (!derecha) return izquierda;
  return `${izquierda} ${derecha}`;
}

function IconoMicrofono() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}

export function BotonVoz({
  texto,
  alCambiarTexto,
  alEnviar,
  deshabilitado = false,
}: PropiedadesBotonVoz) {
  const { t } = useTranslation();
  const [soportado] = useState(soportaVoz);
  const [idioma, setIdioma] = useState<IdiomaVoz>(leerIdiomaVoz);
  const [envioAutomatico, setEnvioAutomatico] = useState(leerEnvioAutomatico);

  // Texto que había en el cuadro al empezar a dictar: lo reconocido se añade a
  // partir de él, así los parciales no borran lo ya escrito.
  const baseRef = useRef(texto);

  const { estado, error, empezar, detener } = useReconocimientoVoz({
    idioma,
    alTexto: (reconocido, esFinal) => {
      const nuevo = unir(baseRef.current, reconocido);
      alCambiarTexto(nuevo);
      if (!esFinal) return;
      baseRef.current = nuevo;
      if (envioAutomatico) alEnviar(nuevo);
    },
  });

  const escuchando = estado === "escuchando";

  useEffect(() => {
    if (!escuchando) baseRef.current = texto;
  }, [texto, escuchando]);

  function alternarDictado() {
    if (escuchando) {
      detener();
      return;
    }
    baseRef.current = texto;
    empezar();
  }

  function cambiarIdioma(valor: string) {
    if (!esIdiomaVoz(valor)) return;
    setIdioma(valor);
    guardarIdiomaVoz(valor);
  }

  function cambiarEnvioAutomatico(activo: boolean) {
    setEnvioAutomatico(activo);
    guardarEnvioAutomatico(activo);
  }

  if (!soportado) return null;

  const mensaje = error
    ? t(`asistente.voz.errores.${error}`)
    : escuchando
      ? t("asistente.voz.escuchando")
      : "";

  return (
    <div className="asistente__voz">
      <select
        className="asistente__voz-idioma"
        aria-label={t("asistente.voz.idioma")}
        value={idioma}
        disabled={deshabilitado}
        onChange={(evento) => cambiarIdioma(evento.target.value)}
      >
        {IDIOMAS_VOZ.map((codigo) => (
          <option key={codigo} value={codigo}>
            {t(`asistente.voz.idiomas.${codigo}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="asistente__voz-boton"
        aria-label={escuchando ? t("asistente.voz.detener") : t("asistente.voz.empezar")}
        aria-pressed={escuchando}
        disabled={deshabilitado}
        onClick={alternarDictado}
      >
        <IconoMicrofono />
      </button>
      <label className="asistente__voz-envio">
        <input
          type="checkbox"
          checked={envioAutomatico}
          disabled={deshabilitado}
          onChange={(evento) => cambiarEnvioAutomatico(evento.target.checked)}
        />
        <span>{t("asistente.voz.enviarAlTerminar")}</span>
      </label>
      <span
        className={`asistente__voz-estado${error ? " asistente__voz-estado--error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {mensaje}
      </span>
      <span className="asistente__voz-ayuda">{t("asistente.voz.ayuda")}</span>
    </div>
  );
}
