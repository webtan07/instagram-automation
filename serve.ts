// Production server for the built app. The TanStack Start build emits a
// portable fetch handler (dist/server/server.js) plus static client assets
// (dist/client); this wraps them in a Bun server on PORT (default 3100).
// Run `bun run build` before starting.
//
// NOTE: this app is NOT the WDA site — it deliberately binds to PORT (default
// 3100), never 3000, and does no port takeover.
import handler from "./dist/server/server.js";

const PORT = Number(process.env.PORT) || 3100;
const HOST = "0.0.0.0";
const CLIENT_DIR = `${import.meta.dir}/dist/client`;

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname !== "/") {
      const file = Bun.file(CLIENT_DIR + pathname);
      if (await file.exists()) return new Response(file);
    }
    return (
      handler as { fetch: (r: Request) => Response | Promise<Response> }
    ).fetch(req);
  },
});

console.log(`instagram-automation serving on http://${HOST}:${String(PORT)}`);
