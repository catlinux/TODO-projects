import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { peticion } from "../api";

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await peticion("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, contrasena }),
      });
      navigate("/proyectos");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="contenedor-formulario">
      <h1>{t("auth.login")}</h1>
      <form onSubmit={enviar}>
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
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={enviando}>
          {t("auth.submitLogin")}
        </button>
      </form>
      <p>
        {t("auth.noAccount")} <a href="/registro">{t("auth.register")}</a>
      </p>
    </main>
  );
}
