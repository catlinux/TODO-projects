import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada archivo arranca un PGlite y aplica migraciones; en paralelo agotan
    // recursos y hacen fallar los beforeAll por tiempo de espera.
    fileParallelism: false,
  },
});
