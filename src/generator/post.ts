import type { ContentRow } from "~/sheets";
import {
  BRAND,
  SIZES,
  brandBackground,
  brandChrome,
  coverImage,
  fetchImageDataUri,
  fitText,
  hashtagPills,
  renderSvgToPng,
  splitHeadlineBody,
  svgDocument,
  textBlock,
} from "./template";

/** A rendered single-image post asset, ready to be staged for publishing. */
export interface GeneratedPostAsset {
  /** Local path under /assets/generated (or object-store URL) of the PNG. */
  path: string;
  width: number;
  height: number;
}

const { width, height } = SIZES.post;
/** Horizontal margin from the canvas edge — text never runs outside this. */
const MARGIN = 90;
const TEXT_W = width - MARGIN * 2; // 900px

/**
 * Render one content row into a branded single-image post (1080x1350, 4:5).
 *
 * Template: brand gradient background, eyebrow + headline + body drawn from
 * `row.content` (word-wrapped to fit — no overflow), `row.hashtags` as pills,
 * and when `row.imageUrl` is set it is fetched and composited as a hero image
 * (cover-cropped). If the image can't be fetched/decoded the layout falls back
 * to text-only rather than failing the whole row.
 *
 * Output: /assets/generated/post-<sheetRow>-<timestamp>.png (gitignored).
 */
export async function generatePostImage(
  row: ContentRow,
  outPath: string,
): Promise<GeneratedPostAsset> {
  const { headline: headlineText, body: bodyText } = splitHeadlineBody(row.content);
  const headline = fitText(headlineText, TEXT_W, 3, [76, 64, 54, 46]);
  const body =
    bodyText === ""
      ? { lines: [] as string[], fontSize: 40 }
      : fitText(bodyText, TEXT_W, 7, [40, 36, 32, 28]);

  // Hero image (optional): fetched + validated by template helper; null → fall
  // back to the text-only layout below.
  const heroDataUri = row.imageUrl ? await fetchImageDataUri(row.imageUrl) : null;

  const heroH = heroDataUri ? 640 : 0;
  let inner = brandBackground(width, height);

  if (heroDataUri) {
    inner += `
    ${coverImage(heroDataUri, 0, 0, width, heroH)}
    <rect x="0" y="${heroH - 150}" width="${width}" height="150" fill="url(#brand-bg)" opacity="0.96"/>`;
  }

  const contentTop = heroH + 60;
  // Eyebrow sits over the hero's bottom edge when present, else near the top.
  inner += brandChrome(width, height, "WEB DIGITAL ASSISTANTS", contentTop + 30);

  const headlineTop = contentTop + 150;
  inner += textBlock(
    headline.lines,
    width / 2,
    headlineTop,
    headline.fontSize,
    headline.fontSize * 1.18,
    BRAND.white,
    { anchor: "middle", weight: 700 },
  );
  const headlineBottom =
    headlineTop + headline.lines.length * headline.fontSize * 1.18;

  // Only render a separate body when it differs from the headline (long rows).
  const bodyLines =
    body.lines.join(" ") === headline.lines.join(" ") ? [] : body.lines;
  if (bodyLines.length > 0) {
    inner += textBlock(
      bodyLines,
      width / 2,
      headlineBottom + 54,
      body.fontSize,
      body.fontSize * 1.4,
      BRAND.body,
      { anchor: "middle" },
    );
  }

  // Hashtags pinned above the bottom accent bar.
  inner += hashtagPills(
    row.hashtags,
    MARGIN,
    height - 180,
    TEXT_W,
    34,
  );

  const svg = svgDocument(width, height, inner);
  renderSvgToPng(svg, width, height, outPath);
  return { path: outPath, width, height };
}
