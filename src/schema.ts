/**
 * Database types + DDL for the Instagram Content Automation app.
 *
 * The CREATE TABLE SQL below is the canonical schema. Unlike the scaffold,
 * it is now executable: `ensureSchema()` runs it (idempotently — every
 * statement uses IF NOT EXISTS) against the configured Neon database via
 * src/db.ts, so a fresh deploy self-heals before the first query.
 *
 * Column names in the DB are snake_case; src/db.ts normalizes every row to
 * the camelCase interfaces below (snake_case columns → camelCase fields).
 */
export type ContentType = "post" | "carousel" | "reel";
export type ContentStatus =
  | "pending" // read from the sheet, not yet queued
  | "generating" // assets are being rendered
  | "staged" // assets ready, waiting for its scheduled time
  | "scheduled" // (reserved for future "pushed to scheduler" state)
  | "published" // successfully published to Instagram
  | "failed"; // generation or publishing failed; `error` holds details

/** One materialized row of the Google Sheet, as normalized from `content_items`. */
export interface ContentItem {
  id: number;
  /** 1-based row number in the source Google Sheet (UNIQUE). */
  sheetRow: number;
  contentType: ContentType;
  caption: string;
  /** Null when the sheet row had no parseable schedule. */
  scheduledFor: Date | string | null;
  status: ContentStatus;
  /** jsonb — array of asset paths in /assets/generated (or remote URLs). */
  assetPaths: string[];
  /** jsonb — hashtags read from the sheet. */
  hashtags: string[];
  /** Pre-made image URL from the sheet, if any. */
  imageUrl: string | null;
  igMediaId: string | null;
  error: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** One successful publish attempt, for audit/retry, as normalized from `publish_log`. */
export interface PublishLog {
  id: number;
  contentItemId: number;
  publishedAt: Date | string;
  igMediaId: string;
  /** jsonb — raw API response from POST /{ig-user-id}/media_publish. */
  response: Record<string, unknown>;
}

/**
 * Canonical DDL — every statement is idempotent (IF NOT EXISTS).
 *
 * Kept as an array of individual statements: the Neon serverless driver
 * (like the WDA site's db layer) executes each statement on its own, so
 * `ensureSchema()` runs them one at a time.
 */
export const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS content_items (
  id            serial PRIMARY KEY,
  sheet_row     int NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('post', 'carousel', 'reel')),
  caption       text NOT NULL,
  scheduled_for timestamptz,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','generating','staged','scheduled','published','failed')),
  asset_paths   jsonb NOT NULL DEFAULT '[]'::jsonb,
  hashtags      jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url     text,
  ig_media_id   text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
)`,
  `CREATE TABLE IF NOT EXISTS publish_log (
  id              serial PRIMARY KEY,
  content_item_id int NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  published_at    timestamptz NOT NULL DEFAULT now(),
  ig_media_id     text NOT NULL,
  response        jsonb NOT NULL DEFAULT '{}'::jsonb
)`,
  `CREATE INDEX IF NOT EXISTS idx_content_items_status_due
  ON content_items (status, scheduled_for)`,
];

/**
 * Idempotent migrations for databases created before the Sheets import landed
 * (every statement is safe to re-run). Kept separate from CREATE_TABLES so the
 * "fresh schema" DDL stays the canonical shape.
 */
export const MIGRATIONS: string[] = [
  // hashtags / image_url columns (Sheets import persistence)
  `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS hashtags jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE content_items ADD COLUMN IF NOT EXISTS image_url text`,
  // scheduled_for may be NULL when the sheet row has no parseable schedule
  `ALTER TABLE content_items ALTER COLUMN scheduled_for DROP NOT NULL`,
  // unique key on sheet_row → ON CONFLICT (sheet_row) DO UPDATE upsert.
  // Postgres has no ADD CONSTRAINT IF NOT EXISTS, so guard via pg_constraint.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_items_sheet_row_key') THEN
       ALTER TABLE content_items ADD CONSTRAINT content_items_sheet_row_key UNIQUE (sheet_row);
     END IF;
   END $$`,
];

/** The full DDL (tables + migrations) as one string, for reference. */
export const CREATE_TABLES_SQL =
  [...CREATE_TABLES, ...MIGRATIONS].join(";\n") + ";\n";

/**
 * Create the schema if it does not exist yet. Safe to call on every app
 * startup / before any query — the DDL is fully idempotent.
 *
 * Lives here (schema module) as the canonical home of "make the DB match the
 * schema"; the implementation delegates to src/db.ts's `sql()` via a dynamic
 * import so this module stays a pure source of truth for types + DDL (no
 * static import cycle).
 */
export async function ensureSchema(): Promise<void> {
  const { sql } = await import("./db");
  const db = sql();
  // Neon's HTTP driver executes one statement per call, so run the DDL array
  // statement-by-statement. `${db.unsafe(stmt)}` inlines the raw SQL (the
  // unsafe marker is for interpolation, not a standalone executor) — a plain
  // ${stmt} would bind the DDL as a query parameter and fail.
  for (const statement of [...CREATE_TABLES, ...MIGRATIONS]) {
    await db`${db.unsafe(statement)}`;
  }
}
