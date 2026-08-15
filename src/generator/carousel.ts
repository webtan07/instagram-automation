import type { ContentRow } from "~/sheets";

/**
 * Render one content row into a multi-slide carousel.
 *
 * TODO(integration): same approach as generatePostImage (HTML template +
 * Playwright screenshot) but produce N slides (e.g. split `caption` into
 * sections, or render `row.imageUrl` + quote cards). Slides are 1080x1350.
 */
export async function generateCarousel(row: ContentRow): Promise<string[]> {
  // The slide renderer isn't wired up yet — this is a scaffold.
  // Returns an array of asset paths, one per slide, in order.
  throw new Error(`not implemented: generateCarousel (${row.type})`);
}
