import { createServerFn } from "@tanstack/react-start";
import { config } from "~/config";
import { ensureSchema, getPipelineStats, listContentItems } from "~/db";
import type { ContentStatus, ContentType } from "~/schema";

/**
 * Pipeline snapshot served to the dashboard — the contract between the data
 * source (Postgres via src/db.ts) and the UI (src/routes/index.tsx).
 *
 * NOTE: this file lives under src/routes/api/ so it can become a real
 * `GET /api/pipeline` HTTP route later (TanStack Start API-route style), but
 * for now it exports a plain `createServerFn` — the same pattern the WDA site
 * uses — consumed by the dashboard via its route loader.
 */
export interface PipelineSnapshot {
  pipeline: {
    total: number;
    pending: number;
    generating: number;
    staged: number;
    scheduled: number;
    published: number;
    failed: number;
    schedulerRunning: boolean;
  };
  /** The configured sheet id, shown shortened on the dashboard. */
  sheetId: string | null;
  contentItems: Array<{
    id: number;
    type: ContentType;
    caption: string;
    scheduledFor: string | null;
    status: ContentStatus;
    error: string | null;
    assetCount: number;
  }>;
}

function toIso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Server function: returns the live pipeline snapshot to the dashboard —
 * real status counts from `content_items` (via getPipelineStats) and the real
 * item list (via listContentItems). The schema is ensured idempotently on
 * every call, so a fresh deploy renders truthfully even before a migration
 * has run by hand.
 */
export const getPipelineStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<PipelineSnapshot> => {
    await ensureSchema();
    const stats = await getPipelineStats();
    const items = await listContentItems();
    return {
      pipeline: {
        total: stats.total,
        pending: stats.pending,
        generating: stats.generating,
        staged: stats.staged,
        scheduled: stats.scheduled,
        published: stats.published,
        failed: stats.failed,
        // The in-app cron scheduler is a stub until the integrations land —
        // nothing starts it, so it is truthfully idle.
        schedulerRunning: false,
      },
      sheetId: config.googleSheetId ?? null,
      contentItems: items.map((item) => ({
        id: item.id,
        type: item.contentType,
        caption: item.caption,
        scheduledFor: toIso(item.scheduledFor),
        status: item.status,
        error: item.error,
        assetCount: item.assetPaths.length,
      })),
    };
  },
);
