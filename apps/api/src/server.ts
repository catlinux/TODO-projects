import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { buildApp } from "./app.js";
import { createDatabase } from "./db/index.js";

export async function start(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL no está definida");
  }

  const port = Number(process.env.PORT ?? "3000");
  const { db, pool } = createDatabase(databaseUrl);
  const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

  await migrate(db, { migrationsFolder });
  const app = await buildApp(db);
  await app.listen({ port, host: "0.0.0.0" });

  const shutdown = async (): Promise<void> => {
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
