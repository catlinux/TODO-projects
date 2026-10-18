import type { ReactNode } from "react";

import { BarraNavegacion } from "./BarraNavegacion";

export function Disposicion({ children }: { children: ReactNode }) {
  return (
    <div className="disposicion">
      <BarraNavegacion />
      <div className="disposicion__contenido">{children}</div>
    </div>
  );
}
