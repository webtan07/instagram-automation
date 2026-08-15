# Instagram Content Automation

An automation that reads content rows from a Google Sheet, generates
Instagram-ready assets (image posts, carousels, reels), and publishes them to
Instagram on a schedule — fully hands-off, like a mini Later/Buffer.

This is the **scaffold**: the full-stack shell (TanStack Start + Neon Postgres +
node-cron) compiles and runs, and every external integration (Google Sheets,
asset generation, Instagram publishing) is a typed stub with a TODO describing
exactly how it will be wired in.

## What it does (target behaviour)

1. **Read** content rows (caption, type, scheduled time, hashtags, optional
   image) from a Google Sheet via the Sheets API v4.
2. **Generate** the asset for each row — image posts / carousel slides via a
   Playwright HTML-template render, reels via a Remotion composition — into
   `/assets/generated`.
3. **Publish** to Instagram through the Meta Graph API (v21.0) Content
   Publishing endpoints.
4. **Schedule** everything with an in-app node-cron job.

## Architecture

```
┌──────────────┐   Sheets API v4    ┌──────────────────┐
│ Google Sheet │ ─────────────────► │  fetchSheetRows  │  (src/sheets.ts)
└──────────────┘                    └────────┬─────────┘
                                             │ content rows (ContentRow[])
                                             ▼
                              ┌───────────────────────────┐
                              │  content_items (Postgres) │  (src/schema.ts, src/db.ts)
                              │  pending → generating →   │
                              │  staged → scheduled →     │
                              │  published / failed       │
                              └─────────────┬─────────────┘
                                            │
                     ┌──────────────────────┼───────────────────────┐
                     ▼                      ▼                       ▼
        ┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────┐
        │ generatePostImage│   │ generateCarousel     │   │ generateReel     │
        │ (Playwright)     │   │ (Playwright slides)  │   │ (Remotion → MP4) │
        └────────┬─────────┘   └──────────┬───────────┘   └────────┬─────────┘
                 │                       assets in /assets/generated │
                 ▼                        (image URLs)              ▼
        ┌───────────────────────────────────────────────────────────────────┐
        │  Instagram Graph API client (src/instagram/client.ts, v21.0)      │
        │  POST /{ig-user-id}/media → POST /{ig-user-id}/media_publish      │
        └───────────────────────────────┬───────────────────────────────────┘
                                        ▼
                               ┌──────────────────┐
                               │ publish_log      │  audit trail (src/schema.ts)
                               └──────────────────┘
        Every minute: node-cron (src/scheduler.ts) scans content_items where
        scheduled_for <= now AND status = 'staged' → publish; a separate step
        moves pending → generating → staged as assets finish rendering.
```

## Tool stack

- **Bun** — runtime, package manager, scripts
- **TypeScript** — strict, everywhere
- **TanStack Start** (React + Vite) — SSR app, file-based routing,
  `createServerFn` for server-side logic
- **Tailwind CSS v4** — styling (dark theme)
- **Neon Postgres** via `@neondatabase/serverless` — persistence
- **node-cron** — in-app scheduler

## Setup

```bash
bun install
cp .env.example .env        # fill in DATABASE_URL etc. when integrations land
bun run dev                 # dev server on http://localhost:3100 (PORT env to change)
bun run typecheck           # strict TS check
bun run build               # production build → dist/
bun run start               # serve the production build (after build)
```

The dev server binds to `PORT` (default **3100**). It deliberately never uses
3000 — that port belongs to the WDA site.

## Key design note: we run our own scheduler

Instagram's API **cannot schedule posts** — `POST /{ig-user-id}/media_publish`
publishes immediately and there is no "schedule for later" parameter. Tools like
Later and Buffer are just remote cron schedulers. This app does the same:
node-cron ticks every minute, finds `content_items` whose `scheduled_for` has
arrived and whose assets are `staged`, and publishes them then. This keeps
scheduling server-side and deterministic, with `publish_log` as the audit trail.

## Asset generation

Each content row is turned into real Instagram-ready assets by
`generateAssetsForRow(row, sheetRow)` (`src/generator/index.ts`), dispatched by
`row.type`:

| Row type | Generator | Output |
|---|---|---|
| `post` | `src/generator/post.ts` — branded 1080x1350 (4:5) PNG | `assets/generated/post-<sheetRow>-<ts>.png` |
| `carousel` | `src/generator/carousel.ts` — 3–6 slides, 1080x1350 PNG each (cover + content sections + CTA) | `assets/generated/carousel-<sheetRow>-<ts>-<n>.png` |
| `reel` | `src/generator/reel.ts` — 1080x1920 (9:16) H.264 MP4, ~15s, 30fps, silent (Ken Burns zoom via ffmpeg) | `assets/generated/reel-<sheetRow>-<ts>.mp4` |

Templates and rasterization live in `src/generator/template.ts`:
- **No browser.** SVG templates are rasterized with **@resvg/resvg-js** (a small
  pure-Rust native lib) — no Playwright/Chromium and no Remotion, so the whole
  renderer fits in a serverless function.
- **Reels use ffmpeg** via **ffmpeg-static** (bundled static binary, no system
  install needed).
- **Fonts** are bundled in `assets/fonts/` (DejaVu Sans, ~1.4MB) — serverless
  runtimes have no system fonts, and without a registered font resvg renders no
  text at all.

The dashboard (`/` or `/dashboard`) has a **Generate** button per pending/failed
row — it calls the `generateAssets` server function
(`src/routes/api/generate.ts`), which moves the row
`pending → generating → staged` (with `asset_paths` filled in) or to `failed`
(with an error message) and shows the result inline.

### Serverless caveat (Vercel)

On Vercel the function filesystem is **ephemeral** — files written to
`assets/generated/` during a request vanish when the request ends. Staging paths
in the DB is therefore only meaningful on a machine with persistent disk (local
dev, or wherever a long-running process lives). That's acceptable for now: the
upcoming IG-publishing step will **regenerate-and-publish in one pass** (render
→ upload to Instagram → done, no durable files needed), or we add object
storage at that point. `build-vercel.sh` already ships the native deps (the
ffmpeg binary, the resvg napi binding, and `assets/fonts`) into the render
function so generation *runs* on Vercel today.

## Project layout

```
src/
  db.ts                  # Neon sql() helper (server-only)
  config.ts              # env-var reading + validation
  schema.ts              # DB types + CREATE TABLE SQL (not executed)
  sheets.ts              # Google Sheets API v4 reader (JWT bearer auth)
  import.ts              # sheet → content_items upsert
  generator/index.ts     # generateAssetsForRow dispatch + output naming
  generator/template.ts  # shared SVG brand template + resvg rasterizer + fonts
  generator/post.ts      # single-image post render (1080x1350 PNG)
  generator/carousel.ts  # multi-slide carousel render (3–6 PNGs)
  generator/reel.ts      # reel render via ffmpeg (1080x1920 MP4)
  instagram/client.ts    # STUB: Meta IG Graph API v21.0 publishing client
  scheduler.ts           # STUB: node-cron scheduler wiring
  routes/index.tsx       # dashboard shell (status panel + content list)
  routes/api/pipeline.ts # server function: live pipeline snapshot
  routes/api/sheets.ts   # server function: import from Google Sheets
  routes/api/generate.ts # server function: generate assets for one row
```

Sheets import and asset generation are implemented and live; the Instagram
Graph API client and the scheduler are the remaining stubs (`throw new
Error("not implemented")`), wired as later tasks.
