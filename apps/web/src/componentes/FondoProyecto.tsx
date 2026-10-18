import type { FondoProyectoApi } from "../api";

/** Trazos de las curvas de nivel de la maqueta aprobada (Tablero3). */
const TRAZOS_CURVAS = [
  "M-50 620C120 560 210 640 360 600S620 470 780 520 1040 640 1260 560",
  "M-50 660C130 600 220 690 370 650S630 520 790 570 1050 690 1260 610",
  "M-50 700C140 640 230 740 380 700S640 570 800 620 1060 740 1260 660",
  "M-50 740C150 680 240 790 390 750S650 620 810 670 1070 790 1260 710",
  "M-50 140C100 200 260 90 420 150S700 260 860 190 1080 80 1260 150",
  "M-50 100C110 160 270 50 430 110S710 220 870 150 1090 40 1260 110",
  "M-50 60C120 120 280 10 440 70S720 180 880 110 1100 0 1260 70",
  "M560 400c0-60 70-96 140-90s120 52 110 104-70 84-140 78-110-32-110-92z",
  "M520 402c0-86 96-136 190-128s162 74 148 148-96 120-190 112-148-46-148-132z",
  "M480 404c0-112 122-176 240-166s204 96 186 192-122 156-240 146-186-60-186-172z",
];

/** Luminancia relativa del color (0 negro – 1 blanco), según la WCAG. */
function luminancia(hex: string): number {
  const limpio = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) {
    return 1;
  }

  function canal(valor: number): number {
    const normalizado = valor / 255;
    return normalizado <= 0.03928
      ? normalizado / 12.92
      : ((normalizado + 0.055) / 1.055) ** 2.4;
  }

  const r = canal(parseInt(limpio.slice(0, 2), 16));
  const g = canal(parseInt(limpio.slice(2, 4), 16));
  const b = canal(parseInt(limpio.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Fondo «topográfico» del proyecto: degradado del ambiente (o color liso) con
 * las curvas de nivel. Con imágenes (fase E) se usa el ambiente «bosque» por
 * ahora. El velo oscuro mantiene legible la cabecera sobre colores claros.
 */
export function FondoProyecto({ fondo }: { fondo?: FondoProyectoApi | null }) {
  const colorLiso = fondo?.tipo === "color" ? fondo.color : null;
  const ambiente = fondo?.tipo === "ambiente" ? fondo.ambiente : "bosque";
  const clase = colorLiso ? "fondo-proyecto--liso" : `fondo-proyecto--${ambiente}`;
  const conVelo = colorLiso !== null && luminancia(colorLiso) > 0.179;

  return (
    <div
      className={`fondo-proyecto ${clase}`}
      style={colorLiso ? { backgroundColor: colorLiso } : undefined}
    >
      <svg
        className="fondo-proyecto__curvas"
        aria-hidden="true"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="#fff"
        strokeWidth={1.2}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.16 }}
      >
        {TRAZOS_CURVAS.map((trazo) => (
          <path key={trazo} d={trazo} />
        ))}
      </svg>
      {conVelo && <div className="fondo-proyecto__velo" />}
    </div>
  );
}
