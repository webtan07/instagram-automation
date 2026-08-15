import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// NOTE: this app is NOT the WDA site — it must never take over port 3000.
// The dev server binds to PORT (default 3100) so it can run alongside the site.
const PORT = Number(process.env.PORT) || 3100;

export default defineConfig({
  server: {
    port: PORT,
    host: true,
    // Accept any Host header so the app works behind a proxy / tunnel too.
    allowedHosts: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tanstackStart({
      // src/routes/api/pipeline.ts is a server-function module (not a route);
      // keep the router generator from warning about it missing a Route export.
      // NOTE: routeFileIgnorePattern is a REGEX matched against each directory
      // entry name (not a glob) — "^api$" skips the api/ directory entirely.
      router: {
        routeFileIgnorePattern: "^api$",
      },
    }),
    viteReact(),
  ],
});
