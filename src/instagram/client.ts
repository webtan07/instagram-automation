/**
 * Meta Instagram Graph API client (Content Publishing).
 *
 * API version: v21.0 — base URL `https://graph.instagram.com/v21.0`.
 *
 * Publishing flow (single image):
 *   1. POST /{ig-user-id}/media            body: { image_url, caption }
 *      → returns { id: <creation_id> }  (a "container" — NOT yet live)
 *   2. POST /{ig-user-id}/media_publish    body: { creation_id }
 *      → returns { id: <ig_media_id> }  (now live on the profile)
 *
 * Carousel:
 *   1. For each slide: POST /{ig-user-id}/media { image_url, is_carousel_item: true }
 *      → collect each creation_id
 *   2. POST /{ig-user-id}/media { media_type: CAROUSEL, children: "a,b,c", caption }
 *      → carousel creation_id
 *   3. POST /{ig-user-id}/media_publish { creation_id }
 *
 * Reel:
 *   POST /{ig-user-id}/media { media_type: REELS, video_url, caption,
 *                              cover_image_url?, thumb_offset? } → creation_id
 *   then POST /{ig-user-id}/media_publish { creation_id }
 *
 * Long-lived token handling:
 *   - Exchange a short-lived code:  GET /oauth/access_token?grant_type=ig_exchange_token&client_id=...&client_secret=...&access_token=...
 *   - Refresh:                      GET /oauth/refresh_access_token?grant_type=ig_refresh_token&access_token=...
 *   - Long-lived tokens last ~60 days; refresh before expiry. Store the
 *     refreshed token back into INSTAGRAM_ACCESS_TOKEN (config).
 *
 * TODO(integration): implement `callGraph()` — `fetch` with the access token,
 * JSON encode the body, throw on non-200 with the API's error payload, and add
 * a small retry/backoff for rate limits (error code 429) and transient 5xx.
 */
import { requireEnv } from "~/config";

export interface PublishImageParams {
  /** Publicly reachable URL of the rendered image (config.appBaseUrl + asset path). */
  imageUrl: string;
  caption: string;
}

export interface PublishCarouselParams {
  /** Publicly reachable URLs of the rendered slides, in order. */
  imageUrls: string[];
  caption: string;
}

export interface PublishReelParams {
  /** Publicly reachable URL of the rendered MP4. */
  videoUrl: string;
  caption: string;
  /** Optional cover image URL — defaults to the video's first frame. */
  coverImageUrl?: string;
}

/** Successful publish result, ready to store in publish_log. */
export interface PublishResult {
  igMediaId: string;
  /** Post permalink (e.g. https://www.instagram.com/p/<shortcode>/). */
  permalink?: string;
}

export async function publishImage(
  params: PublishImageParams,
): Promise<PublishResult> {
  // TODO: POST /{ig-user-id}/media then /media_publish (see header comment).
  requireEnv("instagramAccessToken", "instagramUserId");
  throw new Error(`not implemented: publishImage (${params.imageUrl})`);
}

export async function publishCarousel(
  params: PublishCarouselParams,
): Promise<PublishResult> {
  // TODO: children media → CAROUSEL container → media_publish (see header comment).
  requireEnv("instagramAccessToken", "instagramUserId");
  throw new Error(
    `not implemented: publishCarousel (${String(params.imageUrls.length)} slides)`,
  );
}

export async function publishReel(params: PublishReelParams): Promise<PublishResult> {
  // TODO: media_type=REELS container → media_publish (see header comment).
  requireEnv("instagramAccessToken", "instagramUserId");
  throw new Error(`not implemented: publishReel (${params.videoUrl})`);
}
