import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../push", () => ({
  soportaPush: vi.fn(() => true),
  estadoPush: vi.fn(async () => "inactivo"),
  activarPush: vi.fn(async () => "activo"),
  desactivarPush: vi.fn(async () => {}),
}));

import "../i18n/index";
import { activarPush, estadoPush, soportaPush } from "../push";
import { AvisosNavegador } from "./AvisosNavegador";

function stubClave(estado: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/push/clave") {
        return estado === 200
          ? new Response(JSON.stringify({ clave: "clave" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          : new Response(JSON.stringify({ mensaje: "no" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
      }
      return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    }),
  );
}

describe("AvisosNavegador", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("ofrece activar los avisos cuando están inactivos", async () => {
    stubClave(200);
    vi.mocked(soportaPush).mockReturnValue(true);
    vi.mocked(estadoPush).mockResolvedValue("inactivo");
    vi.mocked(activarPush).mockResolvedValue("activo");

    const user = userEvent.setup();
    render(<AvisosNavegador />);

    expect(await screen.findByText("Avisos del navegador desactivados")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /activar avisos/i }));

    expect(await screen.findByText("Avisos del navegador activados")).toBeTruthy();
    expect(activarPush).toHaveBeenCalled();
  });

  it("informa si el navegador no admite avisos", async () => {
    stubClave(200);
    vi.mocked(soportaPush).mockReturnValue(false);

    render(<AvisosNavegador />);

    expect(await screen.findByText("Tu navegador no admite avisos")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /activar avisos/i })).toBeNull();
  });

  it("informa si el servidor no tiene push configurado", async () => {
    stubClave(404);
    vi.mocked(soportaPush).mockReturnValue(true);

    render(<AvisosNavegador />);

    expect(await screen.findByText("Los avisos del servidor no están configurados")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /activar avisos/i })).toBeNull();
  });

  it("informa si el permiso está bloqueado", async () => {
    stubClave(200);
    vi.mocked(soportaPush).mockReturnValue(true);
    vi.mocked(estadoPush).mockResolvedValue("bloqueado");

    render(<AvisosNavegador />);

    expect(await screen.findByText("Permiso bloqueado en el navegador")).toBeTruthy();
  });
});
