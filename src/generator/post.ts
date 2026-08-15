import type { ContentRow } from "~/sheets";

/** A rendered single-image post asset, ready to be staged for publishing. */
export interface GeneratedPostAsset {
  /** Local path under /assets/generated (or object-store URL) of the PNG/JPG. */
  path: string;
  width: number;
  height: number;
}

/**
 * Render one content row into a branded single-image post (1080x1350, 4:5).
 *
 * TODO(integration): HTML/CSS template + Playwright screenshot:
 *   1. Render an HTML template (brand colors, gradient background, `caption`,
 *      `hashtags` styled in, optional `row.imageUrl` as the hero image) in a
 *      headless Chromium page sized 1080x1350 (deviceScaleFactor 1).
 *   2. `page.screenshot({ type: "png" })` → write to
 *      `/assets/generated/post-<sheetRow>-<timestamp>.png`.
 *   3. Return { path, width: 1080, height: 1350 }.
 *
 * TODO: cache-bust / idempotency — regenerating the same row should overwrite
 * or version the asset deterministically so re-runs don't orphan files.
 */
export async function generatePostImage(row: ContentRow): Promise<GeneratedPostAsset> {
  // The Playwright template render isn't wired up yet — this is a scaffold.
  throw new Error(`not implemented: generatePostImage (${row.type})`);
}
