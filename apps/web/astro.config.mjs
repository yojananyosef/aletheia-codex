import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: {
    host: true,
    port: 4321,
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ["better-sqlite3"],
    },
  },
});
