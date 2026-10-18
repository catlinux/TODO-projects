import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const version = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim();

export default defineConfig({
  plugins: [react()],
  define: { __VERSION_WEB__: JSON.stringify(version) },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (ruta: string) => ruta.replace(/^\/api/, ""),
      },
    },
  },
});
