import { SignJWT, importPKCS8 } from "jose";
import { config, requireEnv } from "~/config";

/**
 * Google Sheets integration — reads content rows from the owner's spreadsheet
 * using the Sheets API v4 REST endpoint, authenticated with the service
 * account from GOOGLE_SERVICE_ACCOUNT_JSON (a standard service-account key:
 * a lightweight JWT bearer-token flow, no heavyweight SDK).
 *
 * Flow:
 *   1. Sign a short-lived RS256 JWT with the service account's private key
 *      (audience = the key's token_uri, scope = spreadsheets read+write).
 *   2. Exchange it for an OAuth access token at token_uri.
 *   3. GET /spreadsheets/{id}/values/{range}?valueRenderOption=UNFORMATTED_VALUE
 *      — raw values, so date cells arrive as Excel serial numbers (JSON
 *      numbers) and text cells as strings, which we parse unambiguously.
 *   4. Map headers case-insensitively to the canonical columns.
 *
 * The service account is an editor on the sheet, so when the sheet is empty
 * (no header row) we write a canonical header row first (values.update).
 */

/** Timezone used to interpret bare serial-number dates (no explicit tz). */
export const TZ = "Australia/Brisbane";

export type ContentType = "post" | "carousel" | "reel";

/** A single content row as read from the Google Sheet. */
export interface ContentRow {
  /** Caption / body copy for the post. */
  content: string;
  /** Which asset generator to use. */
  type: ContentType;
  /** When the post should go live — null when missing/unparseable. */
  scheduledFor: Date | null;
  /** Space/comma-separated hashtags from the sheet, split and trimmed. */
  hashtags: string[];
  /** Optional pre-made image URL — if present, skip generation for `post`. */
  imageUrl: string | null;
}

/** Raw cell value as returned by values.get with UNFORMATTED_VALUE render. */
export type CellValue = string | number | boolean | null;

/** Canonical header row written to an empty sheet (row 1). */
export const CANONICAL_HEADERS = [
  "content",
  "type",
  "scheduled_for",
  "hashtags",
  "image_url",
] as const;

export interface SheetData {
  sheetId: string;
  /** Name of the first tab (the content tab). */
  title: string;
  /** Raw header row (row 1) — as found in the sheet. */
  headers: string[];
  /** Data rows (row 2 onward), raw cell values, ragged arrays allowed. */
  rows: CellValue[][];
  /** True when the sheet was empty and we wrote the canonical header row. */
  wroteHeader: boolean;
}

// ── Service-account auth ───────────────────────────────────────────────────

interface ServiceAccountKey {
  type?: string;
  project_id?: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  token_uri: string;
  [key: string]: unknown;
}

/** Parse the service-account key — accepts raw JSON or base64-encoded JSON. */
export function parseServiceAccount(raw: string): ServiceAccountKey {
  let text = raw.trim();
  if (!text.startsWith("{")) {
    text = Buffer.from(text, "base64").toString("utf-8");
  }
  const parsed = JSON.parse(text) as ServiceAccountKey;
  if (!parsed.private_key || !parsed.client_email || !parsed.token_uri) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is missing private_key/client_email/token_uri",
    );
  }
  return parsed;
}

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Obtain a (cached) OAuth access token via the JWT bearer flow. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const key = parseServiceAccount(config.googleServiceAccountJson!);
  const privateKey = await importPKCS8(key.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SHEETS_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setSubject(key.client_email)
    .setAudience(key.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);
  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Google OAuth failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Google OAuth returned no access_token");
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// ── Sheets API v4 helpers ──────────────────────────────────────────────────

async function sheetsFetch(
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const token = await getAccessToken();
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sheets API ${res.status} on ${path}: ${text.slice(0, 400)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

interface SheetProperties {
  title?: string;
  gridProperties?: { rowCount?: number };
}

/** Metadata of the first tab — title (for ranges) + grid size (for bounds). */
async function getFirstSheet(
  sheetId: string,
): Promise<{ title: string; gridProperties?: { rowCount?: number } }> {
  const meta = (await sheetsFetch(
    `${sheetId}?fields=sheets.properties(title,gridProperties)`,
  )) as { sheets?: Array<{ properties?: SheetProperties }> };
  const props = meta.sheets?.[0]?.properties;
  if (!props?.title) throw new Error(`Sheet ${sheetId} has no tabs`);
  return { title: props.title, gridProperties: props.gridProperties };
}

async function writeHeaderRow(sheetId: string, title: string): Promise<void> {
  const range = `${title}!A1:E1`;
  await sheetsFetch(
    `${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({
        range,
        majorDimension: "ROWS",
        values: [[...CANONICAL_HEADERS]],
      }),
    },
  );
}

/**
 * Read the whole first tab: raw header + data rows. If the sheet is empty
 * (no header row at all) the canonical header row is written first.
 */
export async function fetchSheetValues(sheetId: string): Promise<SheetData> {
  requireEnv("googleSheetId", "googleServiceAccountJson");
  const { title, gridProperties } = await getFirstSheet(sheetId);
  const rowCount = gridProperties?.rowCount ?? 1000;
  const range = `${title}!A1:ZZ${rowCount}`;
  const data = (await sheetsFetch(
    `${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`,
  )) as { values?: CellValue[][] };
  const values = data.values ?? [];

  let headers: string[];
  let rows: CellValue[][];
  let wroteHeader = false;
  const isEmpty = (row: CellValue[]) =>
    row.length === 0 || row.every((c) => c === null || c === undefined || String(c).trim() === "");
  if (values.length === 0 || isEmpty(values[0])) {
    await writeHeaderRow(sheetId, title);
    wroteHeader = true;
    headers = [...CANONICAL_HEADERS];
    rows = [];
  } else {
    headers = values[0].map((c) => String(c ?? "").trim());
    rows = values.slice(1);
  }
  return { sheetId, title, headers, rows, wroteHeader };
}

// ── Column mapping (case-insensitive) ──────────────────────────────────────

const COLUMN_ALIASES: Record<keyof ContentRow, string[]> = {
  content: ["content", "caption", "text"],
  type: ["type", "format"],
  scheduledFor: ["scheduled_for", "schedule", "datetime", "date"],
  hashtags: ["hashtags", "tags"],
  imageUrl: ["image", "url", "image_url"],
};

/** Lowercase + strip spaces/underscores/dashes so headers match loosely. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/** First matching column index per ContentRow field (undefined if absent). */
export type ColumnIndexes = Record<keyof ContentRow, number | undefined>;

export function mapHeaders(headers: string[]): ColumnIndexes {
  const indexByNormalized = new Map<string, number>();
  headers.forEach((header, i) => {
    const key = normalizeHeader(header);
    if (key && !indexByNormalized.has(key)) indexByNormalized.set(key, i);
  });
  const out: ColumnIndexes = {
    content: undefined,
    type: undefined,
    scheduledFor: undefined,
    hashtags: undefined,
    imageUrl: undefined,
  };
  for (const field of Object.keys(COLUMN_ALIASES) as (keyof ContentRow)[]) {
    for (const alias of COLUMN_ALIASES[field]) {
      const hit = indexByNormalized.get(normalizeHeader(alias));
      if (hit !== undefined) {
        out[field] = hit;
        break;
      }
    }
  }
  return out;
}

// ── Cell parsing ───────────────────────────────────────────────────────────

function cellString(value: CellValue | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

const TYPE_ALIASES: Record<string, ContentType> = {
  post: "post",
  carousel: "carousel",
  reel: "reel",
  // Common friendly labels that mean the same formats.
  single: "post",
  image: "post",
  slideshow: "carousel",
  video: "reel",
  reels: "reel",
};

export function parseType(value: CellValue | undefined): ContentType {
  const key = cellString(value).trim().toLowerCase();
  return TYPE_ALIASES[key] ?? "post";
}

/** Split a hashtag cell on spaces/commas/semicolons; strip leading '#'. */
export function parseHashtags(value: CellValue | undefined): string[] {
  const parts = cellString(value)
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^#+/, ""))
    .filter((t) => t.length > 0);
  return [...new Set(parts)];
}

/** Sheets serial epoch: day 0 is 1899-12-30 (UTC wall). */
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Offset (minutes) of `instant` in `tz`, from Intl (e.g. "GMT+10:00"). */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Convert a Sheets serial number (days since 1899-12-30, may carry a
 * fractional day = time of day) to a Date interpreted in `tz`: the wall-clock
 * date the serial denotes in `tz` is preserved as the returned instant.
 */
export function serialToDate(serial: number, tz: string): Date {
  const utcMs = SERIAL_EPOCH_MS + serial * MS_PER_DAY;
  const wall = new Date(utcMs);
  const offsetMin = tzOffsetMinutes(wall, tz);
  return new Date(utcMs - offsetMin * 60_000);
}

const NUMERIC = /^\d+(\.\d+)?$/;

/**
 * Parse a scheduled-for cell: Sheets serial numbers (numbers, or numeric
 * strings) AND ISO/date strings. Anything missing/invalid → null.
 */
export function parseScheduledFor(value: CellValue | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return serialToDate(value, TZ);
  }
  const text = String(value).trim();
  if (text === "") return null;
  if (NUMERIC.test(text)) {
    return serialToDate(Number(text), TZ);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ── Row mapping ────────────────────────────────────────────────────────────

/** Read the cell at the mapped column for `field`, if that column exists. */
function cellAt(
  cells: CellValue[],
  col: ColumnIndexes,
  field: keyof ColumnIndexes,
): CellValue | undefined {
  const idx = col[field];
  return idx === undefined ? undefined : cells[idx];
}

/** Map one raw data row to a ContentRow, or null when content is empty. */
export function rowToContentRow(
  cells: CellValue[],
  col: ColumnIndexes,
): ContentRow | null {
  const content = cellString(cellAt(cells, col, "content")).trim();
  if (content === "") return null;
  const imageUrl = cellString(cellAt(cells, col, "imageUrl")).trim();
  return {
    content,
    type: parseType(cellAt(cells, col, "type")),
    scheduledFor: parseScheduledFor(cellAt(cells, col, "scheduledFor")),
    hashtags: parseHashtags(cellAt(cells, col, "hashtags")),
    imageUrl: imageUrl === "" ? null : imageUrl,
  };
}

/** Read + map all content rows from the first tab of the sheet. */
export async function fetchSheetRows(sheetId: string): Promise<ContentRow[]> {
  const data = await fetchSheetValues(sheetId);
  const col = mapHeaders(data.headers);
  if (col.content === undefined) {
    throw new Error(
      `No recognizable content column in sheet "${data.title}". Found headers: ${JSON.stringify(data.headers)} — expected one of: content, caption, text.`,
    );
  }
  const rows: ContentRow[] = [];
  for (const cells of data.rows) {
    const row = rowToContentRow(cells, col);
    if (row) rows.push(row);
  }
  return rows;
}
