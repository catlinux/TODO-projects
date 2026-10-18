import { useTranslation } from "react-i18next";

export function Marca() {
  const { t } = useTranslation();

  return (
    <div className="marca">
      <span className="marca__cuadrado" aria-hidden="true">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="marca__nombre">{t("app.title")}</span>
    </div>
  );
}
