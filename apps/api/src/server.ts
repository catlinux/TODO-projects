import { fileURLToPath, pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { buildApp } from "./app.js";
import { createDatabase } from "./db/index.js";
import { suscripcionesPush } from "./db/schema.js";
import { iniciarBucleAvisos, type BucleAvisos } from "./avisos/bucle.js";
import type { Canal } from "./avisos/canal.js";
import { crearCanalCorreo, leerConfigCorreo } from "./avisos/canal-correo.js";
import { crearCanalPush, leerConfigPush } from "./avisos/canal-push.js";

export async function start(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL no está definida");
  }

  const port = Number(process.env.PORT ?? "3000");
  const { db, pool } = createDatabase(databaseUrl);
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

  await migrate(db, { migrationsFolder });

  const configCorreo = leerConfigCorreo();
  const configPush = leerConfigPush();

  const borrarSuscripcion = async (endpoint: string): Promise<void> => {
    await db.delete(suscripcionesPush).where(eq(suscripcionesPush.endpoint, endpoint));
  };

  const canales = [
    crearCanalCorreo(configCorreo),
    crearCanalPush(configPush, undefined, borrarSuscripcion),
  ].filter((canal): canal is Canal => canal !== null);

  console.info(
    canales.length > 0
      ? `Canales de avisos activos: ${canales.map((canal) => canal.id).join(", ")}`
      : "Sin canales de avisos configurados (correo y push desactivados).",
  );

  const app = await buildApp(db, { vapidPublicKey: configPush?.publicKey ?? null });
  await app.listen({ port, host: "0.0.0.0" });

  let bucle: BucleAvisos | null = null;
  const avisosActivos = process.env.AVISOS_ACTIVOS !== "0";
  if (!avisosActivos) {
    console.info("Bucle de avisos desactivado (AVISOS_ACTIVOS=0).");
  } else if (canales.length === 0) {
    console.info("No se inicia el bucle de avisos: no hay ningún canal activo.");
  } else {
    bucle = iniciarBucleAvisos({ db, canales });
  }

  const shutdown = async (): Promise<void> => {
    if (bucle) {
      await bucle.detener();
    }
    await app.close();
    await pool.end();
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
