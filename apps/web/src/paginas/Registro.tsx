import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { peticion } from "../api";

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
    <main className="contenedor-formulario">
      <h1>{t("auth.register")}</h1>
      <form onSubmit={enviar}>
        <label>
          {t("auth.email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
        <button type="submit" disabled={enviando}>
          {t("auth.submitRegister")}
        </button>
      </form>
      <p>
        {t("auth.hasAccount")} <a href="/login">{t("auth.login")}</a>
      </p>
    </main>
  );
}
