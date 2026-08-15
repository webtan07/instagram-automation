import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

/**
 * Shared SVG templating + rasterization for the asset generator.
 *
 * The generator renders branded Instagram assets as SVG and rasterizes them
 * with @resvg/resvg-js (a small pure-Rust native lib — no Chromium, no
 * Playwright, no Remotion, which this sandbox can't fit). post.ts, carousel.ts
 * and reel.ts all build their layouts on top of this module so the brand
 * styling stays in one place.
 *
 * SERVERLESS CAVEAT: on Vercel the function filesystem is ephemeral — files
 * written here vanish after the request. That's fine for the current staging
 * step; the upcoming IG-publishing step will regenerate-and-publish in one
 * pass (or add durable storage).
 */

// ── Brand ───────────────────────────────────────────────────────────────────

export const BRAND = {
  pink: "#ee2a7b",
  pinkSoft: "#f9a8d4",
  violet: "#6d28d9",
  violetSoft: "#c4b5fd",
  ink: "#0b1020",
  white: "#ffffff",
  body: "#e2e8f0",
  muted: "#94a3b8",
  pillBg: "rgba(255,255,255,0.14)",
  pillText: "#ffffff",
} as const;

/** Standard canvas sizes. */
export const SIZES = {
  post: { width: 1080, height: 1350 }, // 4:5
  reel: { width: 1080, height: 1920 }, // 9:16
} as const;

// ── Fonts ───────────────────────────────────────────────────────────────────

/**
 * Bundled fonts (repo assets/fonts, DejaVu Sans — free Bitstream license).
 * They ship into the Vercel function bundle (build-vercel.sh copies
 * assets/fonts into the render function) because a serverless runtime has no
 * system font files — without them resvg renders NO text at all.
 */
const FONT_CANDIDATES = [
  // local dev / repo root
  path.resolve(process.cwd(), "assets/fonts"),
  // bundled into the Vercel render function (build-vercel.sh)
  path.resolve(import.meta.dirname, "assets/fonts"),
  path.resolve(import.meta.dirname, "../../assets/fonts"),
];

function findFontDir(): string | null {
  for (const dir of FONT_CANDIDATES) {
    try {
      if (
        readFileSync(path.join(dir, "DejaVuSans.ttf")).length > 0 &&
        readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")).length > 0
      ) {
        return dir;
      }
    } catch {
      // not here — try next candidate
    }
  }
  return null;
}

const fontDir = findFontDir();
export const FONT_FILES = fontDir
  ? [path.join(fontDir, "DejaVuSans.ttf"), path.join(fontDir, "DejaVuSans-Bold.ttf")]
  : [];

export const FONT_FAMILY = "DejaVu Sans";

// ── Text layout helpers ─────────────────────────────────────────────────────

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Estimate the rendered width of `text` in pixels for `fontSize` in DejaVu
 * Sans. DejaVu is a wide font — average advance is ~0.60em for mixed text, so
 * the estimate is conservative (wraps earlier than needed, preventing
 * overflow). Bold headline letters run slightly wider (~0.63em).
 */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  factor = 0.62,
): number {
  let width = 0;
  for (const ch of text) {
    // Wide glyphs (capitals, digits) count more; spaces less.
    if (ch === " ") width += 0.3 * fontSize;
    else if (/[A-Z0-9]/.test(ch)) width += 0.68 * fontSize;
    else if (/[WwMm@#]/.test(ch)) width += 0.78 * fontSize;
    else if (/[ilI1.,'’]/.test(ch)) width += 0.32 * fontSize;
    else width += 0.58 * fontSize;
  }
  return Math.max(width, fontSize * factor);
}

/**
 * Word-wrap `text` into lines that fit `maxWidthPx` at `fontSize`. Returns []
 * for empty input. Long unbroken words are hard-broken.
 */
export function wrapText(
  text: string,
  maxWidthPx: number,
  fontSize: number,
): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized === "") return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (estimateTextWidth(candidate, fontSize) <= maxWidthPx || line === "") {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      // Hard-break a single word wider than the canvas.
      while (estimateTextWidth(line, fontSize) > maxWidthPx) {
        let cut = line.length;
        while (
          cut > 1 &&
          estimateTextWidth(line.slice(0, cut), fontSize) > maxWidthPx
        ) {
          cut--;
        }
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

/**
 * Fit `text` into `maxLines` at the largest of the given sizes: tries each
 * size (descending) until the wrapped result fits. Returns the lines + the
 * size chosen. Guarantees the caller a shape that cannot overflow vertically.
 */
export function fitText(
  text: string,
  maxWidthPx: number,
  maxLines: number,
  sizes: number[],
): { lines: string[]; fontSize: number } {
  for (const size of sizes) {
    const lines = wrapText(text, maxWidthPx, size);
    if (lines.length <= maxLines) return { lines, fontSize: size };
  }
  const smallest = sizes[sizes.length - 1];
  let lines = wrapText(text, maxWidthPx, smallest).slice(0, maxLines);
  // Mark truncation so the reader knows there is more.
  lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S*$/, "…");
  return { lines, fontSize: smallest };
}

/** Render wrapped lines as <tspan> rows, centered or left-aligned. */
export function textBlock(
  lines: string[],
  x: number,
  y: number,
  fontSize: number,
  lineHeight: number,
  fill: string,
  opts: { anchor?: "middle" | "start"; weight?: 400 | 700; letterSpacing?: number } = {},
): string {
  const anchor = opts.anchor ?? "middle";
  const weight = opts.weight ?? 400;
  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const letterSpacing = opts.letterSpacing ? ` letter-spacing="${opts.letterSpacing}"` : "";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT_FAMILY}" font-weight="${weight}" font-size="${fontSize}" fill="${fill}"${letterSpacing}>${tspans}</text>`;
}

// ── Copy helpers ────────────────────────────────────────────────────────────

/**
 * Split a content row into a headline (first sentence) and a body (the rest).
 * Rows with no sentence boundary (or a single short sentence) are all-headline.
 */
export function splitHeadlineBody(content: string): { headline: string; body: string } {
  const text = content.replace(/\s+/g, " ").trim();
  const m = /^(.{0,110}?[.!?])(?:\s+|$)([\s\S]*)$/.exec(text);
  if (m && m[2].trim() !== "") {
    return { headline: m[1].trim(), body: m[2].trim() };
  }
  return { headline: text, body: "" };
}

// ── Background / decoration ─────────────────────────────────────────────────

/**
 * Brand gradient background (violet → pink, diagonal) with a dark vignette and
 * a couple of translucent glow discs so assets look designed, not flat.
 */
export function brandBackground(width: number, height: number): string {
  const d = Math.min(width, height);
  return `
  <defs>
    <linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c1d95"/>
      <stop offset="0.55" stop-color="#6d28d9"/>
      <stop offset="1" stop-color="#db2777"/>
    </linearGradient>
    <linearGradient id="brand-accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${BRAND.pinkSoft}"/>
      <stop offset="1" stop-color="${BRAND.violetSoft}"/>
    </linearGradient>
    <radialGradient id="glow-a" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f9a8d4" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#f9a8d4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow-b" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#c4b5fd" stop-opacity="0.3"/>
      <stop offset="1" stop-color="#c4b5fd" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#brand-bg)"/>
  <circle cx="${width * 0.85}" cy="${height * 0.12}" r="${d * 0.45}" fill="url(#glow-a)"/>
  <circle cx="${width * 0.08}" cy="${height * 0.85}" r="${d * 0.55}" fill="url(#glow-b)"/>
  <rect width="${width}" height="${height}" fill="url(#brand-bg)" opacity="0.28"/>
  <rect width="${width}" height="${height}" fill="rgba(6,8,18,0.32)"/>
  <rect x="0" y="${height - 14}" width="${width}" height="14" fill="url(#brand-accent)" opacity="0.9"/>`;
}

/** The eyebrow label + brand footer used on every asset. */
export function brandChrome(
  width: number,
  height: number,
  eyebrow: string,
  eyebrowY = 108,
): string {
  return `
  <text x="${width / 2}" y="${eyebrowY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="700" font-size="30" letter-spacing="8" fill="${BRAND.pinkSoft}">${escapeXml(eyebrow)}</text>
  <rect x="${width / 2 - 60}" y="${eyebrowY + 24}" width="120" height="6" rx="3" fill="url(#brand-accent)"/>
  <text x="${width / 2}" y="${height - 72}" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="400" font-size="26" letter-spacing="2" fill="${BRAND.muted}">WEB DIGITAL ASSISTANTS</text>`;
}

/** Hashtag pills laid out on a row (wraps onto up to two rows). */
export function hashtagPills(
  hashtags: string[],
  x: number,
  y: number,
  maxWidth: number,
  fontSize = 34,
): string {
  const tags = hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`));
  const padX = 26;
  const gap = 18;
  const lineHeight = 66;
  let cursorX = x;
  let cursorY = y;
  let lines = 0;
  const out: string[] = [];
  for (const tag of tags) {
    const w = estimateTextWidth(tag, fontSize) + padX * 2;
    if (lines > 0 && cursorX + w > x + maxWidth) {
      cursorX = x;
      cursorY += lineHeight;
      lines++;
    }
    if (lines >= 2) break; // keep the composition tight
    out.push(
      `<rect x="${cursorX}" y="${cursorY - fontSize * 0.72}" width="${w}" height="${fontSize * 1.5}" rx="${fontSize * 0.75}" fill="${BRAND.pillBg}"/>` +
        `<text x="${cursorX + w / 2}" y="${cursorY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="400" font-size="${fontSize}" fill="${BRAND.pillText}">${escapeXml(tag)}</text>`,
    );
    cursorX += w + gap;
    if (cursorX >= x + maxWidth) {
      cursorX = x;
      cursorY += lineHeight;
      lines++;
    }
  }
  return out.join("");
}

// ── Hero image embedding ────────────────────────────────────────────────────

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_HERO_BYTES = 8 * 1024 * 1024;

/**
 * Fetch `url` and return it as a base64 data-URI ready for an SVG <image>.
 * Returns null when the fetch fails, the body is too large, or the bytes are
 * not a PNG/JPEG — the caller falls back to a text-only layout.
 */
export async function fetchImageDataUri(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_HERO_BYTES) return null;
  const isPng = PNG_MAGIC.equals(buf.subarray(0, 4));
  const isJpeg = JPEG_MAGIC.equals(buf.subarray(0, 3));
  if (!isPng && !isJpeg) return null;
  const mime = isPng ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * An <image> element that cover-crops a (data-URI) image into the given box.
 * Returns "" when `dataUri` is null — the layout must adapt.
 */
export function coverImage(dataUri: string, x: number, y: number, w: number, h: number): string {
  return `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${dataUri}" preserveAspectRatio="xMidYMid slice"/>`;
}

// ── Rasterization ───────────────────────────────────────────────────────────

/**
 * Rasterize an SVG document (width x height, CSS pixels = output pixels) to a
 * PNG file, creating parent directories. Throws on render failure.
 */
export function renderSvgToPng(
  svg: string,
  width: number,
  height: number,
  outPath: string,
): void {
  if (width <= 0 || height <= 0) {
    throw new Error(`renderSvgToPng: invalid canvas ${width}x${height}`);
  }
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: FONT_FILES.length === 0, // system fonts only as last resort
      defaultFontFamily: FONT_FAMILY,
    },
  });
  const png = resvg.render().asPng();
  if (png.length === 0) throw new Error(`resvg rendered an empty PNG for ${outPath}`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
}

/** Wrap inner SVG elements in a full document with the brand background. */
export function svgDocument(width: number, height: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${inner}
</svg>`;
}
