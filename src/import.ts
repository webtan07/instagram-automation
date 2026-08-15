import { ensureSchema } from "./db";
import { upsertContentItem } from "./db";
import { fetchSheetValues, mapHeaders, rowToContentRow } from "./sheets";
import type { ContentRow } from "./sheets";

/**
 * Sheet → database import. Reads the first tab of the Google Sheet, maps it to
 * ContentRows, and upserts every non-empty row into `content_items` keyed on
 * `sheet_row` (UNIQUE). Idempotent: re-running refreshes content but never
 * resets a row's pipeline `status`.
 */
export interface ImportSummary {
  sheetId: string;
  /** Rows newly inserted into content_items. */
  imported: number;
  /** Rows whose content was refreshed over an existing content_items row. */
  updated: number;
  /** Sheet rows skipped (empty content / fully blank rows). */
  skipped: number;
  /** 1-based sheet row of the first imported data row (null if none). */
  firstRow: number | null;
  /** 1-based sheet row of the last imported data row (null if none). */
  lastRow: number | null;
  /** True when the sheet was empty and a canonical header row was written. */
  wroteHeader: boolean;
  /** ISO timestamp of this import run. */
  importedAt: string;
}

/**
 * Fetch + map + upsert the whole sheet. Throws on API/network/DB errors so the
 * caller can surface the failure (the server function wraps it).
 */
export async function importSheetToDb(sheetId: string): Promise<ImportSummary> {
  // Self-healing: DDL + migrations run idempotently on every import, so a
  // fresh database (or one created before the Sheets import landed) is ready.
  await ensureSchema();

  const data = await fetchSheetValues(sheetId);
  const col = mapHeaders(data.headers);
  if (col.content === undefined) {
    throw new Error(
      `No recognizable content column in sheet "${data.title}". Found headers: ${JSON.stringify(data.headers)} — expected one of: content, caption, text.`,
    );
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let firstRow: number | null = null;
  let lastRow: number | null = null;

  // values[0] is the header (row 1); data rows start at sheet row 2.
  for (let i = 0; i < data.rows.length; i++) {
    const sheetRow = i + 2;
    const row: ContentRow | null = rowToContentRow(data.rows[i], col);
    if (row === null) {
      skipped++;
      continue;
    }
    const { inserted } = await upsertContentItem({
      sheetRow,
      contentType: row.type,
      caption: row.content,
      scheduledFor: row.scheduledFor,
      hashtags: row.hashtags,
      imageUrl: row.imageUrl,
    });
    if (inserted) imported++;
    else updated++;
    if (firstRow === null) firstRow = sheetRow;
    lastRow = sheetRow;
  }

  return {
    sheetId,
    imported,
    updated,
    skipped,
    firstRow,
    lastRow,
    wroteHeader: data.wroteHeader,
    importedAt: new Date().toISOString(),
  };
}
