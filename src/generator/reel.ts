import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ContentRow } from "~/sheets";
import {
  BRAND,
  SIZES,
  brandBackground,
  brandChrome,
  fitText,
  hashtagPills,
  renderSvgToPng,
  splitHeadlineBody,
  svgDocument,
  textBlock,
} from "./template";

/** A rendered reel video asset, ready to be staged for publishing. */
export interface GeneratedReelAsset {
  /** Local path under /assets/generated (or object-store URL) of the MP4. */
  path: string;
  durationSeconds: number;
  width: number;
  height: number;
}

const { width, height } = SIZES.reel;
const MARGIN = 90;
const TEXT_W = width - MARGIN * 2;

const FPS = 30;
const TARGET_DURATION = 15; // seconds — IG allows 3s–15min; 15s is the default

// ── ffmpeg resolution ───────────────────────────────────────────────────────

const require = createRequire(import.meta.url);

/**
 * Locate a usable ffmpeg binary. Order:
 *  1. $FFMPEG_PATH (explicit override)
 *  2. ffmpeg-static's resolved path (its index.js joins __dirname + "ffmpeg";
 *     in the Vercel bundle __dirname is the render function dir, where
 *     build-vercel.sh drops the binary)
 *  3. repo node_modules/ffmpeg-static/ffmpeg (local dev)
 *  4. "ffmpeg" on PATH (system install)
 */
export function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  try {
    const fromStatic = require("ffmpeg-static") as string;
    if (typeof fromStatic === "string" && fromStatic && existsSync(fromStatic)) {
      return fromStatic;
    }
  } catch {
    // ffmpeg-static not installed — fall through
  }
  const candidates = [
    path.resolve(process.cwd(), "node_modules/ffmpeg-static/ffmpeg"),
    path.resolve(import.meta.dirname, "ffmpeg"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "ffmpeg binary not found — install ffmpeg-static (or set FFMPEG_PATH). Reel generation needs it.",
  );
}

function runFfmpeg(args: string[]): Promise<void> {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

// ── Frame layouts (1080x1920 SVG) ───────────────────────────────────────────

function titleFrame(row: ContentRow): string {
  const { headline } = splitHeadlineBody(row.content);
  const fitted = fitText(headline, TEXT_W, 4, [104, 88, 74, 62, 52]);
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, "REEL", 120) +
    textBlock(
      fitted.lines,
      width / 2,
      720,
      fitted.fontSize,
      fitted.fontSize * 1.14,
      BRAND.white,
      { anchor: "middle", weight: 700 },
    );
  return svgDocument(width, height, inner);
}

function bodyFrame(content: string): string {
  const fitted = fitText(content, TEXT_W, 9, [60, 54, 48, 42, 36]);
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, "WEB DIGITAL ASSISTANTS", 120) +
    textBlock(
      fitted.lines,
      width / 2,
      620,
      fitted.fontSize,
      fitted.fontSize * 1.28,
      BRAND.white,
      { anchor: "middle", weight: 700 },
    );
  return svgDocument(width, height, inner);
}

function tagsFrame(row: ContentRow): string {
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, "FOLLOW ALONG", 120) +
    hashtagPills(row.hashtags, MARGIN, 800, TEXT_W, 46) +
    `<text x="${width / 2}" y="${height - 260}" text-anchor="middle" font-family="DejaVu Sans" font-weight="700" font-size="52" fill="${BRAND.white}">Follow for more</text>`;
  return svgDocument(width, height, inner);
}

function ctaFrame(): string {
  const fitted = fitText(
    "DM us for a free automation checkup",
    TEXT_W,
    3,
    [72, 64, 56, 48],
  );
  const inner =
    brandBackground(width, height) +
    brandChrome(width, height, "READY WHEN YOU ARE", 150) +
    textBlock(
      fitted.lines,
      width / 2,
      760,
      fitted.fontSize,
      fitted.fontSize * 1.3,
      BRAND.white,
      { anchor: "middle", weight: 700 },
    ) +
    `<text x="${width / 2}" y="${height - 200}" text-anchor="middle" font-family="DejaVu Sans" font-weight="400" font-size="36" fill="${BRAND.muted}">webdigitalassistants.com</text>`;
  return svgDocument(width, height, inner);
}

/**
 * Render one content row into a short-form reel (1080x1920, 9:16, H.264 MP4).
 *
 * Approach: render 4–5 brand PNG frames from the row (title / body / hashtags
 * / CTA / outro) with the shared SVG template, then encode each frame as a
 * 3s-ish Ken Burns segment (slow zoom via ffmpeg zoompan, 30fps) and concat
 * them with the concat demuxer (-c copy). Silent audio track omitted (-an) —
 * IG accepts silent reels; adding music/voice is a later step.
 *
 * Output: /assets/generated/reel-<sheetRow>-<timestamp>.mp4.
 *
 * SERVERLESS CAVEAT: ffmpeg must be present in the function — build-vercel.sh
 * copies node_modules/ffmpeg-static/ffmpeg into the render function. On Vercel
 * the produced MP4 is also ephemeral (see src/generator/template.ts).
 */
export async function generateReel(
  row: ContentRow,
  outPath: string,
): Promise<GeneratedReelAsset> {
  // 1. Build the frame SVGs (4–5 frames: short copy skips the body frame).
  const { body } = splitHeadlineBody(row.content);
  const frames: string[] = [titleFrame(row)];
  if (body !== "") frames.push(bodyFrame(body));
  frames.push(tagsFrame(row), ctaFrame());

  const nFrames = frames.length; // 4 or 5
  const perSegment = TARGET_DURATION / nFrames;
  const framesPerSegment = Math.max(1, Math.round(perSegment * FPS));
  const durationSeconds = (framesPerSegment * nFrames) / FPS;

  // 2. Rasterize frames next to the output (temp dir, cleaned up below).
  const tmpDir = path.join(
    path.dirname(outPath),
    `.tmp-${path.basename(outPath, ".mp4")}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  const pngPaths: string[] = [];
  try {
    for (let i = 0; i < frames.length; i++) {
      const png = path.join(tmpDir, `frame-${i}.png`);
      renderSvgToPng(frames[i], width, height, png);
      pngPaths.push(png);
    }

    // 3. Encode each frame as a slow-zoom H.264 segment.
    const segmentPaths: string[] = [];
    const zoom = "min(zoom+0.0015,1.15)";
    for (let i = 0; i < pngPaths.length; i++) {
      const seg = path.join(tmpDir, `seg-${i}.mp4`);
      await runFfmpeg([
        "-y",
        "-loop", "1",
        "-framerate", String(FPS),
        "-i", pngPaths[i],
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},` +
          `zoompan=z='${zoom}':d=${framesPerSegment}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${FPS}`,
        "-frames:v", String(framesPerSegment),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-an",
        seg,
      ]);
      segmentPaths.push(seg);
    }

    // 4. Concat the segments (identical codecs → stream copy).
    const listPath = path.join(tmpDir, "concat.txt");
    writeFileSync(
      listPath,
      segmentPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n",
    );
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    path: outPath,
    durationSeconds,
    width,
    height,
  };
}
