import { createServerFn } from "@tanstack/react-start";

import type { ContentStatus, ContentType } from "~/schema";

/**
 * Static snapshot of the pipeline for the dashboard shell. Later this will
 * read real counts from `content_items` / `publish_log` via src/db.ts — the
 * shape below is the contract, so the UI and the data source can evolve
 * independently.
 *
 * NOTE: this file lives under src/routes/api/ so it can become a real
 * `GET /api/pipeline` HTTP route later (TanStack Start API-route style), but
 * for now it exports a plain `createServerFn` — the same pattern the WDA site
 * uses — consumed by the dashboard via its route loader.
 */
export interface PipelineSnapshot {
  pipeline: {
    sheetRows: number;
    pending: number;
    generating: number;
    staged: number;
    scheduled: number;
    published: number;
    failed: number;
    lastSyncAt: string | null;
    schedulerRunning: boolean;
  };
  scheduledContent: Array<{
    id: number;
    type: ContentType;
    caption: string;
    scheduledFor: string;
    status: ContentStatus;
  }>;
}

const SAMPLE_SNAPSHOT: PipelineSnapshot = {
  pipeline: {
    sheetRows: 12,
    pending: 4,
    generating: 1,
    staged: 3,
    scheduled: 2,
    published: 2,
    failed: 0,
    lastSyncAt: null,
    schedulerRunning: false,
  },
  scheduledContent: [
    {
      id: 1,
      type: "post",
      caption: "5 automation wins for solo founders",
      scheduledFor: "2026-08-21T09:00:00.000Z",
      status: "staged",
    },
    {
      id: 2,
      type: "carousel",
      caption: "How we cut 6 hours of busywork a week",
      scheduledFor: "2026-08-22T09:00:00.000Z",
      status: "pending",
    },
    {
      id: 3,
      type: "reel",
      caption: "Behind the scenes: the pipeline in action",
      scheduledFor: "2026-08-23T09:00:00.000Z",
      status: "scheduled",
    },
  ],
};

/**
 * Server function: returns the pipeline snapshot to the dashboard.
 */
export const getPipelineStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<PipelineSnapshot> => {
    // TODO(integration): query real counts from content_items / publish_log
    // (see src/schema.ts) instead of returning the static sample.
    return SAMPLE_SNAPSHOT;
  },
);
