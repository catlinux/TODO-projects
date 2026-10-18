import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../db/index.js";
import type { Canal } from "./canal.js";
import { iniciarBucleAvisos } from "./bucle.js";

const canal: Canal = { id: "correo", async enviar() {} };

interface DbFalso {
  db: Database;
  llamadas: number;
}

function crearDbFalso(respuesta: () => Promise<unknown>): DbFalso {
  const estado: DbFalso = { llamadas: 0, db: null as unknown as Database };
  estado.db = {
    selectDistinct: () => ({
      from: () => ({ where: async () => [] }),
    }),
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: () => {
              estado.llamadas += 1;
              return respuesta();
            },
          }),
        }),
      }),
    }),
  } as unknown as Database;
  return estado;
}

describe("iniciarBucleAvisos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ejecuta una pasada por intervalo", async () => {
    const falso = crearDbFalso(async () => []);
    const registrar = { error: vi.fn() };
    const bucle = iniciarBucleAvisos({
      db: falso.db,
      canales: [canal],
      intervaloMs: 1000,
      ahora: () => new Date("2026-05-10T10:00:00.000Z"),
      registrar,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(falso.llamadas).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(falso.llamadas).toBe(2);

    await bucle.detener();
  });

  it("no solapa pasadas si una tarda más que el intervalo", async () => {
    let resolver: () => void = () => {};
    const pendiente = new Promise<void>((resolverPromesa) => {
      resolver = resolverPromesa;
    });
    const falso = crearDbFalso(() => pendiente.then(() => []));
    const bucle = iniciarBucleAvisos({
      db: falso.db,
      canales: [canal],
      intervaloMs: 1000,
      ahora: () => new Date("2026-05-10T10:00:00.000Z"),
      registrar: { error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(falso.llamadas).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(falso.llamadas).toBe(1);

    resolver();
    await vi.advanceTimersByTimeAsync(1000);
    expect(falso.llamadas).toBe(2);

    await bucle.detener();
  });

  it("un error no detiene el bucle", async () => {
    let primera = true;
    const falso = crearDbFalso(async () => {
      if (primera) {
        primera = false;
        throw new Error("fallo de prueba");
      }
      return [];
    });
    const registrar = { error: vi.fn() };
    const bucle = iniciarBucleAvisos({
      db: falso.db,
      canales: [canal],
      intervaloMs: 1000,
      ahora: () => new Date("2026-05-10T10:00:00.000Z"),
      registrar,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(registrar.error).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(falso.llamadas).toBe(2);

    await bucle.detener();
  });

  it("detener espera a la pasada en curso y no programa más", async () => {
    let resolver: () => void = () => {};
    const pendiente = new Promise<void>((resolverPromesa) => {
      resolver = resolverPromesa;
    });
    const falso = crearDbFalso(() => pendiente.then(() => []));
    const bucle = iniciarBucleAvisos({
      db: falso.db,
      canales: [canal],
      intervaloMs: 1000,
      ahora: () => new Date("2026-05-10T10:00:00.000Z"),
      registrar: { error: vi.fn() },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(falso.llamadas).toBe(1);

    let detenido = false;
    const espera = bucle.detener().then(() => {
      detenido = true;
    });
    await Promise.resolve();
    expect(detenido).toBe(false);

    resolver();
    await espera;
    expect(detenido).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(falso.llamadas).toBe(1);
  });
});
