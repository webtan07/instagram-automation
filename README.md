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

## Project layout

```
src/
  db.ts                  # Neon sql() helper (server-only)
  config.ts              # env-var reading + validation
  schema.ts              # DB types + CREATE TABLE SQL (not executed)
  sheets.ts              # STUB: Google Sheets API v4 reader
  generator/post.ts      # STUB: Playwright HTML-template image render
  generator/carousel.ts  # STUB: multi-slide carousel render → asset paths
  generator/reel.ts      # STUB: Remotion composition → MP4
  instagram/client.ts    # STUB: Meta IG Graph API v21.0 publishing client
  scheduler.ts           # STUB: node-cron scheduler wiring
  routes/index.tsx       # dashboard shell (status panel + content list)
  routes/api/pipeline.ts # server function: static pipeline snapshot
```

All integrations are stubs that `throw new Error("not implemented")` — real
Google/Instagram calls and DB migrations are later tasks.
