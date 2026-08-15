import { neon } from "@neondatabase/serverless";
import { CREATE_TABLES, MIGRATIONS } from "./schema";
import type {
  ContentItem,
  ContentStatus,
  ContentType,
  PublishLog,
} from "./schema";

/**
 * Server-only handle to the app's database (Neon serverless Postgres over HTTP).
 * The connection string comes from `DATABASE_URL` (see .env.example). Resolved
 * lazily (per call, not at module load) so the app still builds and serves
 * before a database is connected — the error only surfaces if a query actually
 * runs without `DATABASE_URL`.
 *
 * Use it only inside a `createServerFn()` handler or an API route (never client
 * code). All helpers below are parameterized — never concatenate user input
 * into SQL strings.
 */
export const sql = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — copy .env.example to .env and add the Neon connection string before running queries.",
    );
  }
  return neon(url);
};

// ── Schema ────────────────────────────────────────────────────────────────

/**
 * Run the canonical DDL (CREATE TABLE IF NOT EXISTS …) plus the idempotent
 * migrations (new columns / unique key) — so a database created before this
 * version self-heals on first use. Each statement runs on its own — the Neon
 * serverless driver executes single statements only, so a multi-statement
 * string would silently no-op.
 */
export async function ensureSchema(): Promise<void> {
  const db = sql();
  for (const statement of [...CREATE_TABLES, ...MIGRATIONS]) {
    // db.unsafe() inlines the raw SQL fragment (it is a marker for the driver,
    // not a standalone executor); plain ${statement} would bind the DDL as a
    // query parameter and fail.
    await db`${db.unsafe(statement)}`;
  }
}

// ── Row normalization (snake_case columns → camelCase TS interfaces) ──────

type AnyRow = Record<string, unknown>;

function toContentItem(row: AnyRow): ContentItem {
  return {
    id: row.id as number,
    sheetRow: row.sheet_row as number,
    contentType: row.content_type as ContentType,
    caption: row.caption as string,
    scheduledFor: (row.scheduled_for ?? null) as Date | string | null,
    status: row.status as ContentStatus,
    assetPaths: (row.asset_paths ?? []) as string[],
    hashtags: (row.hashtags ?? []) as string[],
    imageUrl: (row.image_url ?? null) as string | null,
    igMediaId: (row.ig_media_id ?? null) as string | null,
    error: (row.error ?? null) as string | null,
    createdAt: row.created_at as Date | string,
    updatedAt: row.updated_at as Date | string,
  };
}

function toPublishLog(row: AnyRow): PublishLog {
  return {
    id: row.id as number,
    contentItemId: row.content_item_id as number,
    publishedAt: row.published_at as Date | string,
    igMediaId: row.ig_media_id as string,
    response: (row.response ?? {}) as Record<string, unknown>,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────

export interface ListContentItemsOptions {
  /** Only items in this status. */
  status?: ContentStatus;
  /** Cap the number of rows returned. */
  limit?: number;
}

/**
 * All content items, ordered by scheduled_for (nulls last) then id desc —
 * soonest due first, most recent creation breaking ties.
 */
export async function listContentItems(
  opts: ListContentItemsOptions = {},
): Promise<ContentItem[]> {
  const { status, limit } = opts;
  const params: unknown[] = [];
  let where = "";
  if (status) {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  let limitClause = "";
  if (limit !== undefined && limit > 0) {
    params.push(limit);
    limitClause = `LIMIT $${params.length}`;
  }
  const rows = await sql().query(
    `SELECT * FROM content_items ${where} ORDER BY scheduled_for ASC NULLS LAST, id DESC ${limitClause}`,
    params,
  );
  return rows.map(toContentItem);
}

/** Fetch one content item by id, or null when no row has that id. */
export async function getContentItemById(id: number): Promise<ContentItem | null> {
  const rows = await sql()`SELECT * FROM content_items WHERE id = ${id}`;
  return rows.length > 0 ? toContentItem(rows[0]) : null;
}

export interface PipelineStats {
  total: number;
  pending: number;
  generating: number;
  staged: number;
  scheduled: number;
  published: number;
  failed: number;
}

/** Counts of content items grouped by status (every status present, 0 if empty). */
export async function getPipelineStats(): Promise<PipelineStats> {
  const rows = await sql()`
    SELECT status, count(*)::int AS count
    FROM content_items
    GROUP BY status
  `;
  const counts: Partial<Record<ContentStatus, number>> = {};
  for (const row of rows) {
    counts[row.status as ContentStatus] = row.count as number;
  }
  const zeroed: Record<ContentStatus, number> = {
    pending: 0,
    generating: 0,
    staged: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
  };
  const merged = { ...zeroed, ...counts };
  const total = Object.values(merged).reduce((a, b) => a + b, 0);
  return { total, ...merged };
}

export interface NewContentItem {
  sheetRow: number;
  contentType: ContentType;
  caption: string;
  scheduledFor: Date | string | null;
  status?: ContentStatus;
  assetPaths?: string[];
  hashtags?: string[];
  imageUrl?: string | null;
  igMediaId?: string | null;
  error?: string | null;
}

/**
 * Insert one content item (defaults: status 'pending', asset_paths '[]',
 * hashtags '[]') and return it.
 *
 * jsonb note: the Neon driver serializes a JS *array* parameter as a Postgres
 * array literal (e.g. `{}` for an empty array), not as JSON — so a bare array
 * param would store `{}` (an object!) in the jsonb column, and a non-empty one
 * would fail outright. Stringify + `::jsonb` casts a JSON document instead.
 */
export async function addContentItem(input: NewContentItem): Promise<ContentItem> {
  const status = input.status ?? "pending";
  const assetPaths = JSON.stringify(input.assetPaths ?? []);
  const hashtags = JSON.stringify(input.hashtags ?? []);
  const igMediaId = input.igMediaId ?? null;
  const error = input.error ?? null;
  const imageUrl = input.imageUrl ?? null;
  const rows = await sql()`
    INSERT INTO content_items
      (sheet_row, content_type, caption, scheduled_for, status, asset_paths, hashtags, image_url, ig_media_id, error)
    VALUES
      (${input.sheetRow}, ${input.contentType}, ${input.caption}, ${input.scheduledFor}, ${status}, ${assetPaths}::jsonb, ${hashtags}::jsonb, ${imageUrl}, ${igMediaId}, ${error})
    RETURNING *
  `;
  return toContentItem(rows[0]);
}

export interface UpsertContentItemInput {
  sheetRow: number;
  contentType: ContentType;
  caption: string;
  scheduledFor: Date | string | null;
  hashtags?: string[];
  imageUrl?: string | null;
}

export interface UpsertContentItemResult {
  /** True when the row was inserted, false when an existing row was updated. */
  inserted: boolean;
  item: ContentItem;
}

/**
 * Upsert a sheet row into content_items keyed on the UNIQUE sheet_row.
 * On conflict the content columns are refreshed but `status` (and any
 * pipeline state) is deliberately preserved — re-importing the sheet never
 * resets progress. `(xmax = 0)` distinguishes insert from update in the
 * RETURNING clause (xmax is non-zero only for updated rows).
 */
export async function upsertContentItem(
  input: UpsertContentItemInput,
): Promise<UpsertContentItemResult> {
  const hashtags = JSON.stringify(input.hashtags ?? []);
  const imageUrl = input.imageUrl ?? null;
  const rows = await sql()`
    INSERT INTO content_items (sheet_row, content_type, caption, scheduled_for, hashtags, image_url)
    VALUES (${input.sheetRow}, ${input.contentType}, ${input.caption}, ${input.scheduledFor}, ${hashtags}::jsonb, ${imageUrl})
    ON CONFLICT (sheet_row) DO UPDATE SET
      content_type = EXCLUDED.content_type,
      caption = EXCLUDED.caption,
      scheduled_for = EXCLUDED.scheduled_for,
      hashtags = EXCLUDED.hashtags,
      image_url = EXCLUDED.image_url,
      updated_at = now()
    RETURNING *, (xmax = 0) AS is_insert
  `;
  const row = rows[0];
  return { inserted: Boolean(row.is_insert), item: toContentItem(row) };
}

export interface UpdateContentItemExtra {
  igMediaId?: string | null;
  assetPaths?: string[];
  error?: string | null;
}

/**
 * Update an item's status (and optionally ig_media_id / asset_paths / error),
 * returning the updated row, or null if no row has that id.
 */
export async function updateContentItemStatus(
  id: number,
  status: ContentStatus,
  extra: UpdateContentItemExtra = {},
): Promise<ContentItem | null> {
  const params: unknown[] = [status, id];
  const sets: string[] = ["status = $1", "updated_at = now()"];
  if (extra.igMediaId !== undefined) {
    params.push(extra.igMediaId);
    sets.push(`ig_media_id = $${params.length}`);
  }
  if (extra.assetPaths !== undefined) {
    // See addContentItem: jsonb columns need JSON.stringify + ::jsonb cast —
    // a bare JS array param becomes a Postgres array literal, not JSON.
    params.push(JSON.stringify(extra.assetPaths));
    sets.push("asset_paths = $" + params.length + "::jsonb");
  }
  if (extra.error !== undefined) {
    params.push(extra.error);
    sets.push(`error = $${params.length}`);
  }
  const rows = await sql().query(
    `UPDATE content_items SET ${sets.join(", ")} WHERE id = $2 RETURNING *`,
    params,
  );
  return rows.length > 0 ? toContentItem(rows[0]) : null;
}

/** Record one successful publish for audit/retry. */
export async function logPublish(
  itemId: number,
  igMediaId: string,
  response: Record<string, unknown>,
): Promise<PublishLog> {
  const rows = await sql()`
    INSERT INTO publish_log (content_item_id, ig_media_id, response)
    VALUES (${itemId}, ${igMediaId}, ${JSON.stringify(response)}::jsonb)
    RETURNING *
  `;
  return toPublishLog(rows[0]);
}
