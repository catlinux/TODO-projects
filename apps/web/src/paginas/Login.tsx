import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion } from "../api";
import { Marca } from "../componentes/Marca";
import {
  entrarConHuella,
  guardarMarca,
  leerMarca,
  MARCA_AHORA_NO,
  MARCA_HUELLA,
  registrarHuella,
  soportaHuella,
} from "../huella";

interface MetodosAcceso {
  correo: boolean;
  registro: boolean;
  pin: boolean;
  huella: boolean;
}

function IconoHuella() {
  return (
    <svg
      className="icono"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 3-.8 5-1.6 6.4" />
      <path d="M8.4 6.3A5 5 0 0 1 17 10c0 1.6-.2 3.1-.6 4.6" />
      <path d="M12 14c0 2.6-.6 4.4-.6 4.4" />
      <path d="M14.6 6.6A3 3 0 0 1 16 9.4c0 1.1-.1 2.2-.3 3.3" />
    </svg>
  );
}

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cliente = useQueryClient();

  const metodos = useQuery({
    queryKey: ["auth", "metodos"],
    queryFn: () => peticion<MetodosAcceso>("/auth/metodos"),
  });

  const [email, setEmail] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [soporta, setSoporta] = useState(false);
  const [preguntarHuella, setPreguntarHuella] = useState(false);
  const autoLanzada = useRef(false);

  useEffect(() => {
    void soportaHuella().then(setSoporta);
  }, []);

  const huellaDisponible = metodos.data?.huella === true && soporta;

  async function entrar() {
    await cliente.invalidateQueries({ queryKey: ["yo"] });
    navigate("/proyectos");
  }

  async function intentar(accion: () => Promise<void>) {
    setEnviando(true);
    setError(null);
    try {
      await accion();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error"));
    } finally {
      setEnviando(false);
    }
  }

  // Si este dispositivo ya tiene huella, se lanza sola al abrir; si el navegador
  // lo impide (p. ej. exige un toque), queda el botón.
  useEffect(() => {
    if (!huellaDisponible || autoLanzada.current || leerMarca(MARCA_HUELLA) !== "1") return;
    autoLanzada.current = true;
    entrarConHuella().then(entrar, () => undefined);
  }, [huellaDisponible]);

  function enviarPin(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    void intentar(async () => {
      await peticion("/auth/pin", { method: "POST", body: JSON.stringify({ pin }) });
      if (soporta && !leerMarca(MARCA_HUELLA) && !leerMarca(MARCA_AHORA_NO)) {
        setPreguntarHuella(true);
        return;
      }
      await entrar();
    });
  }

  function enviarCorreo(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    void intentar(async () => {
      await peticion("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, contrasena }),
      });
      await entrar();
    });
  }

  function ahoraNo() {
    guardarMarca(MARCA_AHORA_NO, "1");
    void entrar();
  }

  if (metodos.isLoading) {
    return (
      <main className="pantalla-acceso">
        <div className="tarjeta-acceso">
          <Marca />
          <h1>{t("auth.login")}</h1>
          <p>{t("app.loading")}</p>
        </div>
      </main>
    );
  }

  if (preguntarHuella) {
    return (
      <main className="pantalla-acceso">
        <div className="tarjeta-acceso">
          <Marca />
          <h1>{t("auth.login")}</h1>
          <p>{t("auth.askFingerprint")}</p>
          {error && <p className="error">{error}</p>}
          <div className="acciones">
            <button
              type="button"
              className="boton-principal"
              disabled={enviando}
              onClick={() =>
                void intentar(async () => {
                  await registrarHuella();
                  await entrar();
                })
              }
            >
              {t("auth.activate")}
            </button>
            <button type="button" disabled={enviando} onClick={ahoraNo}>
              {t("auth.notNow")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="pantalla-acceso">
      <div className="tarjeta-acceso">
        <Marca />
        <h1>{t("auth.login")}</h1>

        {metodos.isError && <p className="error">{t("auth.error")}</p>}
        {error && <p className="error">{error}</p>}

        {metodos.data?.pin && (
          <form className="formulario-acceso" onSubmit={enviarPin}>
            <label className="campo-pin">
              {t("auth.pin")}
              <input
                className="cifra"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{6,12}"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="boton-principal boton-ancho" disabled={enviando}>
              {t("auth.submitLogin")}
            </button>
          </form>
        )}

        {metodos.data?.correo && (
          <form className="formulario-acceso" onSubmit={enviarCorreo}>
            <label>
              {t("auth.email")}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              {t("auth.password")}
              <input
                type="password"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="boton-principal boton-ancho" disabled={enviando}>
              {t("auth.submitLogin")}
            </button>
          </form>
        )}

        {huellaDisponible && (
          <button
            type="button"
            className="boton-secundario boton-ancho"
            disabled={enviando}
            onClick={() =>
              void intentar(async () => {
                await entrarConHuella();
                await entrar();
              })
            }
          >
            <IconoHuella />
            {t("auth.enterWithFingerprint")}
          </button>
        )}

        {metodos.data?.correo && metodos.data.registro && (
          <p className="tarjeta-acceso__pie">
            {t("auth.noAccount")} <a href="/registro">{t("auth.register")}</a>
          </p>
        )}
      </div>
    </main>
  );
}
