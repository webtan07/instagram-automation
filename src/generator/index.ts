import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { ContentRow } from "~/sheets";
import { generateCarousel } from "./carousel";
import { generatePostImage } from "./post";
import type { GeneratedPostAsset } from "./post";
import { generateReel } from "./reel";
import type { GeneratedReelAsset } from "./reel";

/**
 * Asset generator entry point — single source of truth for:
 *  - which generator handles which content type,
 *  - output naming (assets/generated/<type>-<sheetRow>-<ts>[-<n>].<ext>),
 *  - one-render-at-a-time serialization (each row render is CPU/disk heavy —
 *    the sandbox must not run several at once).
 *
 * Files land under /assets/generated/ (gitignored) relative to the repo root.
 *
 * SERVERLESS CAVEAT: on Vercel the function filesystem is ephemeral — staged
 * files vanish after the request. The upcoming IG-publishing step will
 * regenerate-and-publish in one pass (or add durable storage), so the paths
 * stored in content_items.asset_paths are meant for the local/publishing run.
 */

/**
 * Canonical output directory for generated assets (gitignored).
 *
 * Defaults to <cwd>/assets/generated for local dev; ASSET_OUTPUT_DIR overrides
 * it because serverless function roots (Vercel /var/task) are READ-ONLY — the
 * deploy sets ASSET_OUTPUT_DIR=/tmp/assets/generated so mkdir/write succeed.
 */
export function generatedDir(): string {
  if (process.env.ASSET_OUTPUT_DIR) {
    return path.resolve(process.env.ASSET_OUTPUT_DIR);
  }
  return path.resolve(process.cwd(), "assets", "generated");
}

/** What a generation produced — union of the per-type results. */
export type GeneratedAssets =
  | { type: "post"; asset: GeneratedPostAsset }
  | { type: "carousel"; assets: string[] }
  | { type: "reel"; asset: GeneratedReelAsset };

/**
 * Delete previously generated assets for the same row so re-runs don't orphan
 * files (deterministic naming keeps this cheap: <type>-<sheetRow>-*).
 */
function removePreviousFor(row: ContentRow, sheetRow: number | undefined): void {
  const dir = generatedDir();
  if (!existsSync(dir)) return;
  const key = sheetRow ?? row.content.slice(0, 24);
  let pattern: RegExp;
  if (row.type === "carousel") {
    pattern = new RegExp(`^carousel-${key}-`);
  } else {
    pattern = new RegExp(`^${row.type}-${key}-`);
  }
  for (const entry of readdirSync(dir)) {
    if (pattern.test(entry)) {
      try {
        rmSync(path.join(dir, entry), { force: true });
      } catch {
        // best-effort cleanup — never fail generation over stale files
      }
    }
  }
}

function outPath(row: ContentRow, sheetRow: number | undefined, suffix = ""): string {
  const key = sheetRow ?? "row";
  const ts = Date.now();
  return path.join(generatedDir(), `${row.type}-${key}-${ts}${suffix}`);
}

/**
 * Generate all assets for one content row. Serialized internally (module-level
 * promise queue) so concurrent calls never render at the same time.
 *
 * `sheetRow` is optional (ContentRow doesn't carry it) — the pipeline passes
 * the DB row's sheet_row so filenames map back to the spreadsheet.
 */
export function generateAssetsForRow(
  row: ContentRow,
  sheetRow?: number,
): Promise<GeneratedAssets> {
  const run = queue.then(() => generateNow(row, sheetRow));
  // Keep the queue alive after failures so one bad row can't wedge the rest.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let queue: Promise<void> = Promise.resolve();

async function generateNow(
  row: ContentRow,
  sheetRow: number | undefined,
): Promise<GeneratedAssets> {
  mkdirSync(generatedDir(), { recursive: true });
  removePreviousFor(row, sheetRow);

  switch (row.type) {
    case "post": {
      const asset = await generatePostImage(row, outPath(row, sheetRow, ".png"));
      return { type: "post", asset };
    }
    case "carousel": {
      const assets = await generateCarousel(row, (index) =>
        outPath(row, sheetRow, `-${index}.png`),
      );
      return { type: "carousel", assets };
    }
    case "reel": {
      const asset = await generateReel(row, outPath(row, sheetRow, ".mp4"));
      return { type: "reel", asset };
    }
    default: {
      // Exhaustiveness guard — ContentType is closed but stay safe at runtime.
      throw new Error(`Unsupported content type: ${(row as { type: string }).type}`);
    }
  }
}
