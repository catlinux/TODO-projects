import { afterEach, describe, expect, it, vi } from "vitest";

import { aBase64url, deBase64url, entrarConHuella, registrarHuella, soportaHuella } from "./huella";

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const bytes = (...valores: number[]) => new Uint8Array(valores).buffer;

function stubCredenciales(credenciales: Partial<CredentialsContainer>) {
  Object.defineProperty(navigator, "credentials", { value: credenciales, configurable: true });
}

describe("huella", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("codifica y decodifica base64url sin relleno", () => {
    const original = new Uint8Array([0, 251, 255, 62, 63, 1]);
    const codificado = aBase64url(original);
    expect(codificado).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(new Uint8Array(deBase64url(codificado))).toEqual(original);
    expect(aBase64url(new Uint8Array())).toBe("");
  });

  it("no ofrece huella si el navegador no tiene WebAuthn", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(await soportaHuella()).toBe(false);
    vi.stubGlobal("PublicKeyCredential", {
      isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(true),
    });
    expect(await soportaHuella()).toBe(true);
  });

  it("registra la huella enviando la clave pública y guarda la marca", async () => {
    const llamadas: { url: string; cuerpo: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        llamadas.push({ url, cuerpo: init?.body ? JSON.parse(String(init.body)) : null });
        if (url === "/api/auth/huella/registro-opciones") {
          return json({
            challenge: aBase64url(bytes(1, 2, 3)),
            rp: { id: "todo.ejemplo.com", name: "TODO-projects" },
            user: { id: aBase64url(bytes(9)), name: "Ana", displayName: "Ana" },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: { userVerification: "required" },
            attestation: "none",
            timeout: 1000,
            excludeCredentials: [{ type: "public-key", id: aBase64url(bytes(7)) }],
          });
        }
        return json({ id: "p1" }, 201);
      }),
    );
    const create = vi.fn().mockResolvedValue({
      id: "cred-1",
      response: {
        clientDataJSON: bytes(10),
        getAuthenticatorData: () => bytes(11),
        getPublicKey: () => bytes(12),
        getPublicKeyAlgorithm: () => -7,
      },
    });
    stubCredenciales({ create });

    await registrarHuella("Móvil");

    const opciones = create.mock.calls[0]![0].publicKey as PublicKeyCredentialCreationOptions;
    expect(new Uint8Array(opciones.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(opciones.user.id as ArrayBuffer)).toEqual(new Uint8Array([9]));
    expect(llamadas[1]).toEqual({
      url: "/api/auth/huella/registro",
      cuerpo: {
        id: "cred-1",
        clientDataJSON: aBase64url(bytes(10)),
        authenticatorData: aBase64url(bytes(11)),
        publicKey: aBase64url(bytes(12)),
        publicKeyAlgorithm: -7,
        nombre: "Móvil",
      },
    });
    expect(localStorage.getItem("todo.huella")).toBe("1");
  });

  it("avisa si el navegador no da la clave pública", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          challenge: "AQ",
          rp: { id: "x", name: "x" },
          user: { id: "AQ", name: "a", displayName: "a" },
          pubKeyCredParams: [],
          authenticatorSelection: {},
          attestation: "none",
          timeout: 1,
          excludeCredentials: [],
        }),
      ),
    );
    stubCredenciales({
      create: vi.fn().mockResolvedValue({ id: "c", response: { clientDataJSON: bytes(1) } }),
    });
    await expect(registrarHuella()).rejects.toThrow(/no permite activar la huella/);
    expect(localStorage.getItem("todo.huella")).toBeNull();
  });

  it("entra con la huella enviando la firma", async () => {
    const cuerpos: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/huella/entrada-opciones") {
          return json({
            challenge: "AQID",
            rpId: "todo.ejemplo.com",
            allowCredentials: [{ type: "public-key", id: "Bw" }],
            userVerification: "required",
            timeout: 1000,
          });
        }
        cuerpos.push(JSON.parse(String(init?.body)));
        return json({ id: "u1" });
      }),
    );
    stubCredenciales({
      get: vi.fn().mockResolvedValue({
        id: "cred-1",
        response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3) },
      }),
    });

    await entrarConHuella();

    expect(cuerpos[0]).toEqual({
      id: "cred-1",
      clientDataJSON: aBase64url(bytes(1)),
      authenticatorData: aBase64url(bytes(2)),
      signature: aBase64url(bytes(3)),
    });
  });
});
