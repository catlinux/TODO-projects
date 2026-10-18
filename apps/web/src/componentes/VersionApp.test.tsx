import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../i18n";
import { VersionApp } from "./VersionApp";

function montar(version: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ estado: "ok", version }), { status: 200 })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <VersionApp />
    </QueryClientProvider>,
  );
}

describe("VersionApp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("indica que estás al día cuando coinciden", async () => {
    montar(__VERSION_WEB__);
    expect(await screen.findByText("Estás al día.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recargar" })).toBeNull();
  });

  it("avisa y ofrece recargar cuando el servidor es más nuevo", async () => {
    montar("9.9.9");
    expect(await screen.findByText(/versión más nueva/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recargar" })).toBeTruthy();
  });
});
