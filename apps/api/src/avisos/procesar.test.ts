import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";

import {
  avisosEnviados,
  columnas,
  excepcionesOcurrencia,
  proyectos,
  suscripcionesPush,
  tareas,
  usuarios,
} from "../db/schema.js";
import * as schema from "../db/schema.js";
import type { Database } from "../db/index.js";
import { SinDestinoError, type Aviso, type Canal, type DestinoAviso } from "./canal.js";
import { procesarAvisos } from "./procesar.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

class CanalFalso implements Canal {
  enviados: Array<{ destino: DestinoAviso; aviso: Aviso }> = [];
  fallar = false;

  constructor(public id: Canal["id"]) {}

  async enviar(destino: DestinoAviso, aviso: Aviso): Promise<void> {
    if (this.fallar) {
      throw new Error("fallo de prueba");
    }
    this.enviados.push({ destino, aviso });
  }
}

class CanalSinDestino implements Canal {
  readonly id = "push" as const;
  async enviar(): Promise<void> {
    throw new SinDestinoError();
  }
}

describe("procesarAvisos", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let contador = 0;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table avisos_enviados, suscripciones_push, tareas, columnas, proyectos, usuarios restart identity cascade`,
    );
  });

  afterAll(async () => {
    await client.close();
  });

  function ejecutar(ahora: Date, desde: Date, canales: Canal[]) {
    return procesarAvisos(db as unknown as Database, ahora, desde, canales);
  }

  async function crearEscenario(datos: {
    titulo?: string;
    venceEn: Date;
    recordatorioMin: number | null;
    recurrencia?: string | null;
    zona?: string;
  }) {
    contador += 1;
    const [usuario] = await db
      .insert(usuarios)
      .values({
        email: `aviso-${contador}@example.com`,
        nombre: `Usuario ${contador}`,
        passwordHash: "hash-de-prueba",
      })
      .returning();
    const [proyecto] = await db
      .insert(proyectos)
      .values({ nombre: `Proyecto ${contador}`, propietarioId: usuario!.id })
      .returning();
    const [columna] = await db
      .insert(columnas)
      .values({ proyectoId: proyecto!.id, nombre: "Pendiente", posicion: 0 })
      .returning();
    const [tarea] = await db
      .insert(tareas)
      .values({
        proyectoId: proyecto!.id,
        columnaId: columna!.id,
        titulo: datos.titulo ?? `Tarea ${contador}`,
        posicion: 0,
        venceEn: datos.venceEn,
        recurrencia: datos.recurrencia ?? null,
        zona: datos.zona ?? "Europe/Madrid",
        recordatorioMin: datos.recordatorioMin,
      })
      .returning();
    return { usuario: usuario!, proyecto: proyecto!, columna: columna!, tarea: tarea! };
  }

  it("avisa cuando la hora del aviso cae en la ventana", async () => {
    const { proyecto } = await crearEscenario({
      titulo: "Reunión",
      venceEn: new Date("2026-05-10T10:00:00.000Z"),
      recordatorioMin: 15,
    });

    const canal = new CanalFalso("correo");
    const ahora = new Date("2026-05-10T10:00:00.000Z");
    const desde = new Date("2026-05-10T09:40:00.000Z");

    const resultado = await ejecutar(ahora, desde, [canal]);

    expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]!.aviso.titulo).toBe("Recordatorio: Reunión");
    expect(canal.enviados[0]!.aviso.cuerpo).toContain("10/05/2026 12:00");
    expect(canal.enviados[0]!.aviso.urlRelativa).toBe(`/proyectos/${proyecto.id}`);
  });

  it("no avisa si la hora queda fuera de la ventana", async () => {
    await crearEscenario({
      venceEn: new Date("2026-05-10T10:00:00.000Z"),
      recordatorioMin: 30,
    });

    const canal = new CanalFalso("correo");
    const resultado = await ejecutar(
      new Date("2026-05-10T10:00:00.000Z"),
      new Date("2026-05-10T09:40:00.000Z"),
      [canal],
    );

    expect(resultado).toEqual({ enviados: 0, fallidos: 0 });
    expect(canal.enviados).toHaveLength(0);
  });

  it("expande la recurrencia en la zona de la tarea cruzando el cambio de hora", async () => {
    await crearEscenario({
      titulo: "Semanal",
      venceEn: new Date("2026-10-19T02:17:00.000Z"),
      recordatorioMin: 10,
      recurrencia: "FREQ=WEEKLY",
      zona: "Europe/Madrid",
    });

    const canal = new CanalFalso("correo");
    const resultado = await ejecutar(
      new Date("2026-10-26T03:07:00.000Z"),
      new Date("2026-10-26T03:00:00.000Z"),
      [canal],
    );

    expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]!.aviso.cuerpo).toContain("26/10/2026 04:17");
  });

  it("deduplica en dos pasadas", async () => {
    await crearEscenario({ venceEn: new Date("2026-05-10T10:00:00.000Z"), recordatorioMin: 15 });
    const canal = new CanalFalso("correo");
    const ahora = new Date("2026-05-10T10:00:00.000Z");
    const desde = new Date("2026-05-10T09:40:00.000Z");

    const primera = await ejecutar(ahora, desde, [canal]);
    const segunda = await ejecutar(ahora, desde, [canal]);

    expect(primera.enviados).toBe(1);
    expect(segunda).toEqual({ enviados: 0, fallidos: 0 });
    expect(canal.enviados).toHaveLength(1);
    expect(await db.select().from(avisosEnviados)).toHaveLength(1);
  });

  it("un canal que falla no bloquea al otro y se reintenta", async () => {
    await crearEscenario({ venceEn: new Date("2026-05-10T10:00:00.000Z"), recordatorioMin: 15 });
    const correo = new CanalFalso("correo");
    const push = new CanalFalso("push");
    push.fallar = true;
    const ahora = new Date("2026-05-10T10:00:00.000Z");
    const desde = new Date("2026-05-10T09:40:00.000Z");

    const primera = await ejecutar(ahora, desde, [correo, push]);
    expect(primera).toEqual({ enviados: 1, fallidos: 1 });
    expect(correo.enviados).toHaveLength(1);
    expect(push.enviados).toHaveLength(0);

    push.fallar = false;
    const segunda = await ejecutar(ahora, desde, [correo, push]);
    expect(segunda).toEqual({ enviados: 1, fallidos: 0 });
    expect(push.enviados).toHaveLength(1);
    expect(correo.enviados).toHaveLength(1);
  });

  it("avisa con la fecha nueva de una ocurrencia movida y omite la omitida", async () => {
    const { tarea } = await crearEscenario({
      titulo: "Semanal",
      venceEn: new Date("2026-05-10T10:00:00.000Z"),
      recordatorioMin: 0,
      recurrencia: "FREQ=DAILY;COUNT=5",
    });
    await db.insert(excepcionesOcurrencia).values([
      {
        tareaId: tarea.id,
        fechaOriginal: new Date("2026-05-11T10:00:00.000Z"),
        fechaNueva: new Date("2026-05-11T18:00:00.000Z"),
      },
      {
        tareaId: tarea.id,
        fechaOriginal: new Date("2026-05-12T10:00:00.000Z"),
        omitida: true,
      },
    ]);

    const canal = new CanalFalso("correo");

    // La movida avisa a su hora nueva (20:00 en Madrid, CEST).
    const movida = await ejecutar(
      new Date("2026-05-11T18:00:00.000Z"),
      new Date("2026-05-11T17:55:00.000Z"),
      [canal],
    );
    expect(movida).toEqual({ enviados: 1, fallidos: 0 });
    expect(canal.enviados).toHaveLength(1);
    expect(canal.enviados[0]!.aviso.cuerpo).toContain("11/05/2026 20:00");

    // La omitida no avisa a su hora original.
    const omitida = await ejecutar(
      new Date("2026-05-12T10:00:00.000Z"),
      new Date("2026-05-12T09:55:00.000Z"),
      [canal],
    );
    expect(omitida).toEqual({ enviados: 0, fallidos: 0 });
    expect(canal.enviados).toHaveLength(1);
  });

  it("no avisa de tareas sin recordatorio", async () => {
    await crearEscenario({ venceEn: new Date("2026-05-10T10:00:00.000Z"), recordatorioMin: null });
    const canal = new CanalFalso("correo");
    const resultado = await ejecutar(
      new Date("2026-05-10T10:00:00.000Z"),
      new Date("2026-05-10T09:40:00.000Z"),
      [canal],
    );
    expect(resultado).toEqual({ enviados: 0, fallidos: 0 });
  });

  it("no avisa si la ocurrencia ya pasó hace más de 5 minutos", async () => {
    await crearEscenario({ venceEn: new Date("2026-05-10T09:50:00.000Z"), recordatorioMin: 0 });
    const canal = new CanalFalso("correo");
    const resultado = await ejecutar(
      new Date("2026-05-10T10:00:00.000Z"),
      new Date("2026-05-10T09:40:00.000Z"),
      [canal],
    );
    expect(resultado).toEqual({ enviados: 0, fallidos: 0 });
  });

  it("no falla si el usuario no tiene destino push", async () => {
    await crearEscenario({ venceEn: new Date("2026-05-10T10:00:00.000Z"), recordatorioMin: 15 });
    const correo = new CanalFalso("correo");
    const resultado = await ejecutar(
      new Date("2026-05-10T10:00:00.000Z"),
      new Date("2026-05-10T09:40:00.000Z"),
      [correo, new CanalSinDestino()],
    );

    expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    expect(correo.enviados).toHaveLength(1);
    expect(await db.select().from(avisosEnviados)).toHaveLength(1);
  });

  it("pasa al canal push las suscripciones del usuario", async () => {
    const { usuario } = await crearEscenario({
      venceEn: new Date("2026-05-10T10:00:00.000Z"),
      recordatorioMin: 15,
    });
    await db.insert(suscripcionesPush).values([
      { usuarioId: usuario.id, endpoint: "https://push.example.com/1", p256dh: "p1", auth: "a1" },
      { usuarioId: usuario.id, endpoint: "https://push.example.com/2", p256dh: "p2", auth: "a2" },
    ]);

    const push = new CanalFalso("push");
    const resultado = await ejecutar(
      new Date("2026-05-10T10:00:00.000Z"),
      new Date("2026-05-10T09:40:00.000Z"),
      [push],
    );

    expect(resultado).toEqual({ enviados: 1, fallidos: 0 });
    expect(push.enviados[0]!.destino.suscripcionesPush).toHaveLength(2);
  });
});
