/**
 * Database types + DDL for the Instagram Content Automation app.
 *
 * The CREATE TABLE SQL below is the canonical schema — it is intentionally a
 * string constant and is NOT executed by this scaffold. A later migration task
 * runs it against Neon (via src/db.ts) once DATABASE_URL is connected.
 */

export type ContentType = "post" | "carousel" | "reel";

export type ContentStatus =
  | "pending" // read from the sheet, not yet queued
  | "generating" // assets are being rendered
  | "staged" // assets ready, waiting for its scheduled time
  | "scheduled" // (reserved for future "pushed to scheduler" state)
  | "published" // successfully published to Instagram
  | "failed"; // generation or publishing failed; `error` holds details

/** One row of the Google Sheet, materialized into the DB. */
export interface ContentItem {
  id: number;
  sheet_row: number;
  content_type: ContentType;
  caption: string;
  scheduled_for: Date | string;
  status: ContentStatus;
  /** jsonb — array of asset paths in /assets/generated (or remote URLs). */
  asset_paths: string[];
  ig_media_id: string | null;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** One successful publish attempt, for audit/retry. */
export interface PublishLog {
  id: number;
  content_item_id: number;
  published_at: Date | string;
  ig_media_id: string;
  /** jsonb — raw API response from POST /{ig-user-id}/media_publish. */
  response: Record<string, unknown>;
}

/** Canonical DDL. Run against Neon in a later migration task. */
export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS content_items (
  id            serial PRIMARY KEY,
  sheet_row     int NOT NULL,
  content_type  text NOT NULL CHECK (content_type IN ('post', 'carousel', 'reel')),
  caption       text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','generating','staged','scheduled','published','failed')),
  asset_paths   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ig_media_id   text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publish_log (
  id              serial PRIMARY KEY,
  content_item_id int NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  published_at    timestamptz NOT NULL DEFAULT now(),
  ig_media_id     text NOT NULL,
  response        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_content_items_status_due
  ON content_items (status, scheduled_for);
`;
