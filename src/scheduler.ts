import cron from "node-cron";

import { config } from "~/config";

/**
 * In-app scheduler for Instagram publishing.
 *
 * WHY: Instagram's API cannot schedule posts — `POST /{ig-user-id}/media_publish`
 * publishes immediately and there is no "schedule for later" parameter. Tools
 * like Later/Buffer are remote cron schedulers; this app does the same thing
 * itself with node-cron.
 *
 * DESIGN (two-phase, driven by content_items.status):
 *
 *   Every minute, two scans run against Postgres (via src/db.ts):
 *
 *   1. Publish scan — content_items WHERE scheduled_for <= now() AND status = 'staged'
 *      → build the media container (src/instagram/client.ts) and media_publish it;
 *      on success set status = 'published' + insert into publish_log; on failure
 *      set status = 'failed' + write the error into `error`.
 *
 *   2. Staging scan — content_items WHERE scheduled_for <= now() + lead_time
 *      AND status = 'pending' → move to 'generating', render the asset via the
 *      matching src/generator/* function (post / carousel / reel), then set
 *      status = 'staged' once the asset exists (or 'failed' on render error).
 *
 *   Rows whose scheduled_for is far in the future stay 'pending' until their
 *   lead time; everything time-based is evaluated in the server's timezone
 *   (timestamptz is absolute, so DST is a non-issue).
 *
 * TODO(integration): when the DB + publishers exist, replace the log line in
 * the tick with the two scans above. Keep the cron expression "* * * * *" and
 * make each scan idempotent (claim rows with an UPDATE ... WHERE status = X
 * RETURNING so two overlapping ticks can't double-publish).
 */
export function startScheduler(): void {
  // Every minute — see DESIGN comment above.
  cron.schedule("* * * * *", () => {
    console.log(
      `[scheduler] tick at ${new Date().toISOString()} (port ${String(config.port)}) — scans not yet wired to the DB`,
    );
  });
  console.log("[scheduler] started (node-cron, every minute)");
}
