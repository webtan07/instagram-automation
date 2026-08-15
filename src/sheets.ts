import { config, requireEnv } from "~/config";

/**
 * A single content row as read from the Google Sheet (one row = one future
 * Instagram post/carousel/reel).
 *
 * TODO(integration): map the actual sheet columns to this shape (headers are
 * expected to be something like: content | type | scheduled_for | hashtags |
 * image_url). `scheduledFor` should be parsed to a JS Date at read time.
 */
export interface ContentRow {
  /** Caption / body copy for the post. */
  content: string;
  /** Which asset generator to use. */
  type: "post" | "carousel" | "reel";
  /** When the post should go live, as an ISO-8601 datetime. */
  scheduledFor: string;
  /** Space/comma-separated hashtags from the sheet, split and trimmed. */
  hashtags: string[];
  /** Optional pre-made image URL — if present, skip generation for `post`. */
  imageUrl?: string;
}

/**
 * Read all content rows from the configured Google Sheet.
 *
 * TODO(integration): Google Sheets API v4 + service-account flow:
 *   1. Auth: build a JWT client from `config.googleServiceAccountJson`
 *      (GOOGLE_SERVICE_ACCOUNT_JSON) with the google-auth-library, scope
 *      `https://www.googleapis.com/auth/spreadsheets.readonly`.
 *   2. Endpoint: GET
 *      `https://sheets.googleapis.com/v4/spreadsheets/{config.googleSheetId}/values/A1:F200`
 *      (range = the content tab; adjust sheet name/range as needed).
 *   3. Parse: `response.data.values` is a 2D array of cells — row 0 is the
 *      header; map each following row to a ContentRow (skip fully-empty rows).
 *   4. Return rows sorted by `scheduledFor` ascending.
 *
 * Also TODO: decide failure semantics — throw on network/API errors so the
 * caller can mark the sync as failed, or return [] and log.
 */
export async function fetchSheetRows(): Promise<ContentRow[]> {
  requireEnv("googleSheetId", "googleServiceAccountJson");
  // The sheet is not wired up yet — this is a scaffold.
  throw new Error(
    `not implemented: fetchSheetRows (sheet id: ${config.googleSheetId ?? "unset"})`,
  );
}
