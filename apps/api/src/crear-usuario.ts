// Crea un usuario desde la línea de comandos (útil con el registro cerrado).
// Uso: EMAIL=… NOMBRE=… CONTRASENA=… pnpm --filter @todo/api exec tsx src/crear-usuario.ts
import { hash } from "@node-rs/argon2";

import { esquemaRegistro } from "@todo/shared";

import { createDatabase } from "./db/index.js";
import { usuarios } from "./db/schema.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL no está definida");
}

const datos = esquemaRegistro.safeParse({
  email: process.env.EMAIL,
  nombre: process.env.NOMBRE,
  contrasena: process.env.CONTRASENA,
});
if (!datos.success) {
  console.error(datos.error.issues.map((i) => i.message).join("\n"));
  process.exit(1);
}

const { db, pool } = createDatabase(databaseUrl);
try {
  const { email, nombre, contrasena } = datos.data;
  await db.insert(usuarios).values({ email, nombre, passwordHash: await hash(contrasena) });
  console.log(`Usuario creado: ${email}`);
} finally {
  await pool.end();
}
