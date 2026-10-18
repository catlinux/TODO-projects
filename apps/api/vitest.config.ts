import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada archivo arranca un PGlite y aplica migraciones; en paralelo agotan
    // recursos y hacen fallar los beforeAll por tiempo de espera.
    fileParallelism: false,
    // Arrancar PGlite y migrar tarda más que los 10 s por defecto en una
    // máquina cargada; con margen el beforeAll no cae por tiempo de espera.
    hookTimeout: 60_000,
  },
});
