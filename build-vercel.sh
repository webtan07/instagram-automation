#!/usr/bin/env bash
# Produce a Vercel Build Output API bundle (.vercel/output) for this app, then
# deploy it with:  bunx vercel deploy --prebuilt
#
# Mirrors the WDA site's proven pipeline (see webdigitalassistants/build-vercel.sh):
#  - TanStack Start emits a host-agnostic fetch handler (dist/server/server.js)
#    that dynamic-imports its own ./assets chunks and externalizes node deps.
#    Letting Vercel trace/detect that is fragile.
#  - Bundling it into one self-contained set of files (deps + dynamic chunks as
#    real files via --splitting) in a single render.func removes all
#    tracing/detection risk. vercel-entry.ts adapts the Node (req,res) launcher
#    to the web fetch handler.
set -euo pipefail
cd "$(dirname "$0")"
umask 002

echo "[1/3] vite build"
bun install
bun run build

echo "[2/3] assemble .vercel/output (Build Output API v3)"
rm -rf .vercel/output
mkdir -p .vercel/output/functions/render.func
cp -R dist/client .vercel/output/static
rm -f .vercel/output/static/index.html   # SSR owns "/", not a static shell

echo "[2.5/3] copy native runtime deps into the render function"
# The asset generator uses two native/binary deps that JS bundling cannot
# inline. bun bundles their .js wrappers fine, but the binaries themselves
# must be shipped as real files next to the bundle:
#  - ffmpeg-static: index.js resolves __dirname/ffmpeg → drop the binary at
#    the function root (src/generator/reel.ts also probes this path).
#  - @resvg/resvg-js: js-binding.js falls back to require("@resvg/resvg-js-
#    linux-x64-gnu") → keep the napi .node under node_modules/@resvg so Node
#    resolution finds it at runtime. Vercel runs glibc x64 (Node 22).
#  - assets/fonts: serverless runtimes have no system fonts; without them
#    resvg renders no text. The generator probes <func>/assets/fonts.
mkdir -p .vercel/output/functions/render.func/node_modules/@resvg/resvg-js-linux-x64-gnu
cp node_modules/ffmpeg-static/ffmpeg .vercel/output/functions/render.func/ffmpeg
chmod +x .vercel/output/functions/render.func/ffmpeg
cp node_modules/@resvg/resvg-js-linux-x64-gnu/resvgjs.linux-x64-gnu.node \
  .vercel/output/functions/render.func/node_modules/@resvg/resvg-js-linux-x64-gnu/
cp -R assets/fonts .vercel/output/functions/render.func/assets/fonts

echo "[3/3] bundle SSR handler + deps into the render function"
# Split build (--outdir + --splitting) keeps TanStack's dynamically-imported
# server-fn chunks as real files; a single --outfile bundle inlines those
# dynamic imports and the server-fn registry loses its named exports at
# runtime ("Server function module export not resolved"), which broke every
# createServerFn call in production.
bun build vercel-entry.ts --target node \
  --outdir .vercel/output/functions/render.func --splitting
# bun names the entry after the input basename; rename to index.mjs to match
# .vc-config.json. Chunk references inside are relative and survive the rename.
mv .vercel/output/functions/render.func/vercel-entry.js \
  .vercel/output/functions/render.func/index.mjs
# Mark the .js chunks as ESM for the Node runtime (no package.json ships with
# the function dir, and .js defaults to CommonJS without this).
printf '{"type":"module"}\n' > .vercel/output/functions/render.func/package.json

cat > .vercel/output/functions/render.func/.vc-config.json <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.mjs", "launcherType": "Nodejs", "supportsResponseStreaming": true }
JSON
cat > .vercel/output/config.json <<'JSON'
{ "version": 3, "routes": [ { "handle": "filesystem" }, { "src": "/(.*)", "dest": "/render" } ] }
JSON

echo "done -> .vercel/output ready for: bunx vercel deploy --prebuilt"
