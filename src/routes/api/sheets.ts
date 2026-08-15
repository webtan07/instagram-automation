import { createServerFn } from "@tanstack/react-start";
import { config, requireEnv } from "~/config";
import { importSheetToDb } from "~/import";
import type { ImportSummary } from "~/import";

/**
 * Server function: pull the current state of the Google Sheet into Postgres.
 * Mirrors the pipeline.ts pattern — a createServerFn under src/routes/api/
 * (kept out of the router by the "^api$" ignore pattern) that can become a
 * real `POST /api/sheets/import` route later.
 *
 * Returns a discriminated result instead of throwing, so the dashboard can
 * render a friendly error without an unhandled rejection.
 */
export type ImportFromSheetResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string };

export const importFromSheet = createServerFn({ method: "POST" }).handler(
  async (): Promise<ImportFromSheetResult> => {
    try {
      requireEnv("googleSheetId", "googleServiceAccountJson");
      const summary = await importSheetToDb(config.googleSheetId!);
      return { ok: true, summary };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
);
