import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ALGORITMOS,
  configDesdeOrigen,
  crearAlmacenRetos,
  ErrorWebAuthn,
  prepararEntrada,
  verificarRegistro,
} from "./webauthn.js";
import {
  crearAutenticador,
  ORIGEN,
  respuestaEntrada,
  respuestaRegistro,
  RP_ID,
  type Autenticador,
} from "./webauthn-pruebas.js";

const config = configDesdeOrigen(ORIGEN);
const usuarioId = randomUUID();

function registrar(aut: Autenticador, retos = crearAlmacenRetos()) {
  const reto = retos.crear("registro", usuarioId);
  return verificarRegistro(respuestaRegistro(aut, reto), config, retos);
}

describe("WebAuthn", () => {
  it("deriva origen y rpId del origen público", () => {
    expect(configDesdeOrigen("https://todo.ejemplo.com/")).toEqual({
      origen: ORIGEN,
      rpId: RP_ID,
    });
  });

  for (const [nombre, algoritmo] of Object.entries(ALGORITMOS)) {
    it(`registra y entra con ${nombre}`, () => {
      const aut = crearAutenticador(algoritmo);
      const retos = crearAlmacenRetos();
      const credencial = registrar(aut, retos);
      expect(credencial.algoritmo).toBe(algoritmo);
      expect(credencial.usuarioId).toBe(usuarioId);

      const reto = retos.crear("entrada", null);
      const entrada = prepararEntrada(respuestaEntrada(aut, reto), config, retos);
      expect(entrada.credencialId).toBe(credencial.credencialId);
      expect(entrada.verificar(credencial)).toBe(0);
    });
  }

  it("rechaza un reto reutilizado", () => {
    const aut = crearAutenticador();
    const retos = crearAlmacenRetos();
    const reto = retos.crear("registro", usuarioId);
    const respuesta = respuestaRegistro(aut, reto);
    verificarRegistro(respuesta, config, retos);
    expect(() => verificarRegistro(respuesta, config, retos)).toThrow(/Reto/);
  });

  it("rechaza un reto caducado", () => {
    const retos = crearAlmacenRetos(0);
    const reto = retos.crear("registro", usuarioId);
    expect(() =>
      verificarRegistro(respuestaRegistro(crearAutenticador(), reto), config, retos),
    ).toThrow(/Reto/);
  });

  it("rechaza un reto de otro tipo", () => {
    const retos = crearAlmacenRetos();
    const reto = retos.crear("entrada", null);
    expect(() =>
      verificarRegistro(respuestaRegistro(crearAutenticador(), reto), config, retos),
    ).toThrow(/Reto/);
  });

  it("rechaza origen, rpId, tipo de operación y falta de UV o UP", () => {
    const casos = [
      { origin: "https://atacante.example" },
      { rpId: "atacante.example" },
      { type: "webauthn.get" },
      { banderas: 0x01 },
      { banderas: 0x04 },
    ];
    for (const cambios of casos) {
      const retos = crearAlmacenRetos();
      const reto = retos.crear("registro", usuarioId);
      expect(() =>
        verificarRegistro(respuestaRegistro(crearAutenticador(), reto, cambios), config, retos),
      ).toThrow(ErrorWebAuthn);
    }
  });

  it("rechaza una clave que no corresponde al algoritmo y un id distinto", () => {
    const retos = crearAlmacenRetos();
    const aut = crearAutenticador(ALGORITMOS.ES256);
    const conOtroAlgoritmo = {
      ...respuestaRegistro(aut, retos.crear("registro", usuarioId)),
      publicKeyAlgorithm: ALGORITMOS.RS256,
    };
    expect(() => verificarRegistro(conOtroAlgoritmo, config, retos)).toThrow(/algoritmo/);

    const conOtroId = {
      ...respuestaRegistro(aut, retos.crear("registro", usuarioId)),
      id: Buffer.from("otro").toString("base64url"),
    };
    expect(() => verificarRegistro(conOtroId, config, retos)).toThrow(/id/);
  });

  it("rechaza una firma de otra clave", () => {
    const aut = crearAutenticador();
    const retos = crearAlmacenRetos();
    const credencial = registrar(aut, retos);
    const impostor = { ...crearAutenticador(), credencialId: aut.credencialId };
    const entrada = prepararEntrada(
      respuestaEntrada(impostor, retos.crear("entrada", null)),
      config,
      retos,
    );
    expect(() => entrada.verificar(credencial)).toThrow(/Firma/);
  });

  it("rechaza en la entrada origen o rpId incorrectos y falta de UV", () => {
    const aut = crearAutenticador();
    for (const cambios of [
      { origin: "https://atacante.example" },
      { rpId: "atacante.example" },
      { banderas: 0x01 },
    ]) {
      const retos = crearAlmacenRetos();
      expect(() =>
        prepararEntrada(
          respuestaEntrada(aut, retos.crear("entrada", null), cambios),
          config,
          retos,
        ),
      ).toThrow(ErrorWebAuthn);
    }
  });

  it("acepta un contador que avanza y rechaza uno que retrocede o se repite", () => {
    const aut = crearAutenticador();
    const retos = crearAlmacenRetos();
    const credencial = { ...registrar(aut, retos), contador: 5 };

    const avanza = prepararEntrada(
      respuestaEntrada(aut, retos.crear("entrada", null), { contador: 6 }),
      config,
      retos,
    );
    expect(avanza.verificar(credencial)).toBe(6);

    for (const contador of [5, 4, 0]) {
      const entrada = prepararEntrada(
        respuestaEntrada(aut, retos.crear("entrada", null), { contador }),
        config,
        retos,
      );
      expect(() => entrada.verificar(credencial)).toThrow(/Contador/);
    }
  });

  it("descarta los retos más antiguos al llegar al tope", () => {
    const retos = crearAlmacenRetos(60_000, 2);
    const primero = retos.crear("entrada", null);
    retos.crear("entrada", null);
    retos.crear("entrada", null);
    expect(retos.consumir(primero, "entrada")).toBeNull();
  });
});
