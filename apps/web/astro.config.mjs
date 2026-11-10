import tailwindcss from "@tailwindcss/vite";
import node from "@astrojs/node";
import { defineConfig } from "astro/config";

/**
 * Public hosts accepted from the reverse proxy. Without this, Astro builds
 * `Astro.url` from the internal listener (localhost) and rejects normal
 * browser form posts because their Origin is the public site.
 */
function allowedDomains() {
  const domains = [
    { hostname: "localhost", protocol: "http" },
    { hostname: "127.0.0.1", protocol: "http" },
  ];
  const values = [
    process.env.PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.AI_SITE_URL,
  ];
  for (const value of values) {
    if (!value) {
      continue;
    }
    try {
      const url = new URL(
        /^https?:\/\//i.test(value) ? value : `https://${value}`,
      );
      domains.push({
        hostname: url.hostname,
        protocol: url.protocol.replace(":", ""),
        ...(url.port ? { port: url.port } : {}),
      });
    } catch {
      // Ignore malformed optional URLs; the other patterns still apply.
    }
  }
  return domains;
}

export default defineConfig({
  output: "server",
  security: {
    allowedDomains: allowedDomains(),
    // The auth routes validate Origin/Host and a signed CSRF token. Astro's
    // built-in check compares against its internal URL, which is unreliable
    // behind a proxy that preserves the Host but terminates TLS.
    checkOrigin: false,
  },
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
