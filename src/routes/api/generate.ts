import { createServerFn } from "@tanstack/react-start";
import { getContentItemById, updateContentItemStatus } from "~/db";
import { generateAssetsForRow } from "~/generator";
import type { ContentRow } from "~/sheets";
import type { ContentItem } from "~/schema";

/**
 * Asset generation server function — the pipeline step that turns a content
 * row into real post/carousel/reel assets:
 *
 *   pending → generating → staged (asset_paths set) | failed (error set)
 *
 * Guard: only pending/staged rows may (re)generate — never generating /
 * scheduled / published; a row that previously FAILED may retry (the dashboard
 * shows Generate on failed rows so the owner can recover without SQL).
 *
 * Mirrors the pipeline.ts / sheets.ts pattern: a createServerFn under
 * src/routes/api/ (kept out of the router by the "^api$" ignore pattern).
 */

/** Statuses a row may be in for generation to run. */
const GENERATABLE: ReadonlySet<string> = new Set(["pending", "staged", "failed"]);

/** Map a DB ContentItem to the ContentRow shape the generators expect. */
function toContentRow(item: ContentItem): ContentRow {
  return {
    content: item.caption,
    type: item.contentType,
    scheduledFor:
      item.scheduledFor instanceof Date
        ? item.scheduledFor
        : item.scheduledFor
          ? new Date(item.scheduledFor)
          : null,
    hashtags: item.hashtags,
    imageUrl: item.imageUrl,
  };
}

export type GenerateResult =
  | { ok: true; itemId: number; status: string; assetPaths: string[] }
  | { ok: false; itemId?: number; status?: string; error: string };

export const generateAssets = createServerFn({ method: "POST" })
  .validator((data: { id: number }) => data)
  .handler(async ({ data }): Promise<GenerateResult> => {
    const id = data?.id;
    if (!Number.isInteger(id) || (id as number) <= 0) {
      return { ok: false, error: `Invalid content item id: ${JSON.stringify(data)}` };
    }

    const item = await getContentItemById(id);
    if (!item) {
      return { ok: false, error: `Content item #${id} not found` };
    }
    if (!GENERATABLE.has(item.status)) {
      return {
        ok: false,
        itemId: item.id,
        status: item.status,
        error: `Cannot generate while status is "${item.status}" — only pending/staged/failed rows can be (re)generated.`,
      };
    }

    await updateContentItemStatus(id, "generating");
    try {
      const result = await generateAssetsForRow(toContentRow(item), item.sheetRow);
      const assetPaths =
        result.type === "post"
          ? [result.asset.path]
          : result.type === "carousel"
            ? result.assets
            : [result.asset.path];
      await updateContentItemStatus(id, "staged", { assetPaths });
      return { ok: true, itemId: id, status: "staged", assetPaths };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateContentItemStatus(id, "failed", { error: message });
      return { ok: false, itemId: id, status: "failed", error: message };
    }
  });
