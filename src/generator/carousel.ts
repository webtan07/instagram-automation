import type { ContentRow } from "~/sheets";
import {
  BRAND,
  SIZES,
  brandBackground,
  brandChrome,
  fitText,
  hashtagPills,
  renderSvgToPng,
  svgDocument,
  textBlock,
} from "./template";

const { width, height } = SIZES.post;
const MARGIN = 90;
const TEXT_W = width - MARGIN * 2;

/**
 * Split long content into 1–4 balanced sections for the middle slides.
 * Sections are sentences (or the whole row when there's a single sentence),
 * greedily packed so each slide carries roughly one idea.
 */
export function splitSections(content: string, maxSections = 4): string[] {
  const text = content.replace(/\s+/g, " ").trim();
  if (text === "") return [];
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
  if (sentences.length <= 1) return [text];
  const sections: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current === "" ? sentence : `${current} ${sentence}`;
    if (current !== "" && candidate.length > 220) {
      sections.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current !== "") sections.push(current);
  return sections.slice(0, maxSections);
}

/** Small "N / M" progress readout used on every slide after the cover. */
function progressIndicator(index: number, total: number): string {
  const dots = Array.from({ length: total }, (_, i) => {
    const active = i === index;
    return `<rect x="${width / 2 - (total * 34) / 2 + i * 34}" y="${height - 170}" width="18" height="8" rx="4" fill="${active ? BRAND.pinkSoft : "rgba(255,255,255,0.28)"}"/>`;
  }).join("");
  return `<text x="${width / 2}" y="${height - 118}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="26" letter-spacing="4" fill="${BRAND.muted}">${index + 1} / ${total}</text>${dots}`;
}

/** Cover slide: big headline + swipe hint. */
function coverSlide(row: ContentRow): string {
  const fitted = fitText(row.content, TEXT_W, 5, [96, 80, 68, 56, 48]);
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, "WEB DIGITAL ASSISTANTS") +
    textBlock(
      fitted.lines,
      width / 2,
      470,
      fitted.fontSize,
      fitted.fontSize * 1.16,
      BRAND.white,
      { anchor: "middle", weight: 700 },
    ) +
    `<text x="${width / 2}" y="${height - 150}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="36" letter-spacing="6" fill="${BRAND.pinkSoft}">SWIPE →</text>`;
  return svgDocument(width, height, inner);
}

/** Content slide: one section of the copy, big and legible. */
function contentSlide(section: string, index: number, total: number): string {
  const fitted = fitText(section, TEXT_W, 9, [56, 50, 44, 38, 34]);
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, `PART ${index + 1} OF ${total}`, 110) +
    textBlock(
      fitted.lines,
      width / 2,
      400,
      fitted.fontSize,
      fitted.fontSize * 1.3,
      BRAND.white,
      { anchor: "middle", weight: 700 },
    ) +
    progressIndicator(index, total);
  return svgDocument(width, height, inner);
}

/** CTA slide: hashtags + follow prompt. */
function ctaSlide(row: ContentRow): string {
  const fitted = fitText(
    "Follow for more tips — DM us to automate your replies",
    TEXT_W,
    3,
    [56, 50, 44, 38],
  );
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, "WEB DIGITAL ASSISTANTS") +
    textBlock(
      fitted.lines,
      width / 2,
      480,
      fitted.fontSize,
      fitted.fontSize * 1.3,
      BRAND.white,
      { anchor: "middle", weight: 700 },
    ) +
    hashtagPills(row.hashtags, MARGIN, 720, TEXT_W, 40) +
    `<text x="${width / 2}" y="${height - 150}" text-anchor="middle" font-family="DejaVu Sans" font-weight="400" font-size="34" fill="${BRAND.muted}">webdigitalassistants.com</text>`;
  return svgDocument(width, height, inner);
}

/**
 * Render one content row into a multi-slide carousel (3–6 PNG slides, each
 * 1080x1350): a cover slide with the headline, 1–4 content slides carrying the
 * body copy, and a CTA slide with the hashtags. Returns the slide paths in
 * order. Sliding numbering (N / M) is baked in so slides are self-explanatory
 * when posted.
 *
 * Output: /assets/generated/carousel-<sheetRow>-<timestamp>-<n>.png.
 */
export async function generateCarousel(
  row: ContentRow,
  outPathFor: (index: number) => string,
): Promise<string[]> {
  const sections = splitSections(row.content);
  // cover + sections + CTA, capped at 6 slides total (IG limit).
  const contentSlides = sections.length === 0 ? [row.content] : sections.slice(0, 4);
  const total = contentSlides.length + 2;

  const slides = [coverSlide(row)];
  contentSlides.forEach((section, i) => {
    slides.push(contentSlide(section, i + 1, total - 2));
  });
  slides.push(ctaSlide(row));

  const paths: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    const path = outPathFor(i);
    renderSvgToPng(slides[i], width, height, path);
    paths.push(path);
  }
  return paths;
}
