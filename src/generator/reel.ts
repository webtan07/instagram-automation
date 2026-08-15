import type { ContentRow } from "~/sheets";

/** A rendered reel video asset, ready to be staged for publishing. */
export interface GeneratedReelAsset {
  /** Local path under /assets/generated (or object-store URL) of the MP4. */
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Render one content row into a short-form video reel (1080x1920, 9:16, MP4).
 *
 * TODO(integration): Remotion composition → MP4:
 *   1. Define a Remotion <Composition> that animates `caption` / `hashtags` /
 *      `row.imageUrl` over brand motion-graphics (duration from the row or a
 *      default, e.g. 15s, 30fps, 1080x1920).
 *   2. Render with `bunx remotion render` (or the Node API) → write to
 *      `/assets/generated/reel-<sheetRow>-<timestamp>.mp4`.
 *   3. Return { path, durationSeconds, width: 1080, height: 1920 }.
 *
 * TODO: note IG constraints — reels must be 3s–15min, ≤ 4GB, and the first
 * frame is used as the cover unless `cover_image_url` is supplied at publish.
 */
export async function generateReel(row: ContentRow): Promise<GeneratedReelAsset> {
  // The Remotion pipeline isn't wired up yet — this is a scaffold.
  throw new Error(`not implemented: generateReel (${row.type})`);
}
