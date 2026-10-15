import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { peticion } from "../api";
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
      <main className="contenedor-formulario">
        <h1>{t("auth.login")}</h1>
        <p>{t("app.loading")}</p>
      </main>
    );
  }

  if (preguntarHuella) {
    return (
      <main className="contenedor-formulario">
        <h1>{t("auth.login")}</h1>
        <p>{t("auth.askFingerprint")}</p>
        {error && <p className="error">{error}</p>}
        <div className="acciones">
          <button
            type="button"
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
      </main>
    );
  }

  return (
    <main className="contenedor-formulario">
      <h1>{t("auth.login")}</h1>

      {metodos.isError && <p className="error">{t("auth.error")}</p>}
      {error && <p className="error">{error}</p>}

      {huellaDisponible && (
        <button
          type="button"
          disabled={enviando}
          onClick={() =>
            void intentar(async () => {
              await entrarConHuella();
              await entrar();
            })
          }
        >
          {t("auth.enterWithFingerprint")}
        </button>
      )}

      {metodos.data?.pin && (
        <form onSubmit={enviarPin}>
          <label>
            {t("auth.pin")}
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6,12}"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={enviando}>
            {t("auth.submitLogin")}
          </button>
        </form>
      )}

      {metodos.data?.correo && (
        <form onSubmit={enviarCorreo}>
          <label>
            {t("auth.email")}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
          <button type="submit" disabled={enviando}>
            {t("auth.submitLogin")}
          </button>
        </form>
      )}

      {metodos.data?.correo && metodos.data.registro && (
        <p>
          {t("auth.noAccount")} <a href="/registro">{t("auth.register")}</a>
        </p>
      )}
    </main>
  );
}
