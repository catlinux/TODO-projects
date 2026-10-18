import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { peticion } from "../api";
import { Marca } from "../componentes/Marca";

export default function Registro() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await peticion("/auth/registro", {
        method: "POST",
        body: JSON.stringify({ email, nombre, contrasena }),
      });
      navigate("/proyectos");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="pantalla-acceso">
      <div className="tarjeta-acceso">
        <Marca />
        <h1>{t("auth.register")}</h1>
        <form className="formulario-acceso" onSubmit={enviar}>
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
            {t("auth.name")}
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
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
          {error && <p className="error">{error}</p>}
          <button type="submit" className="boton-principal boton-ancho" disabled={enviando}>
            {t("auth.submitRegister")}
          </button>
        </form>
        <p className="tarjeta-acceso__pie">
          {t("auth.hasAccount")} <a href="/login">{t("auth.login")}</a>
        </p>
      </div>
    </main>
  );
}
