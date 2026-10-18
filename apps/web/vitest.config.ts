import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __VERSION_WEB__: JSON.stringify("0.0.0-test") },
  test: {
    environment: "jsdom",
    globals: false,
    env: { TZ: "Europe/Madrid" },
  },
});
