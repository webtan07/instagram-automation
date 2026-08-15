/**
 * Central env-var access + validation for the Instagram Content Automation app.
 *
 * Every integration reads its settings from this single `config` object rather
 * than touching `process.env` directly. Nothing here throws at import time —
 * the app must build and serve without a single env var set (it's a scaffold);
 * use `requireEnv()` at the point a feature actually needs its credentials.
 */
export interface AppConfig {
  /** Neon Postgres connection string (src/db.ts). */
  databaseUrl?: string;
  /** Full JSON of the Google service-account key (src/sheets.ts). */
  googleServiceAccountJson?: string;
  /** Spreadsheet id from the sheet URL (src/sheets.ts). */
  googleSheetId?: string;
  /** Long-lived Instagram user access token (src/instagram/client.ts). */
  instagramAccessToken?: string;
  /** IG user id for POST /{ig-user-id}/media (src/instagram/client.ts). */
  instagramUserId?: string;
  /** Instagram business/creator account id (Meta Business settings). */
  instagramAccountId?: string;
  /** Public base URL of this app, used for asset URLs sent to the IG API. */
  appBaseUrl: string;
  /** Port the dev/start server binds to (default 3100 — never 3000). */
  port: number;
}

const str = (key: string) => {
  const v = process.env[key];
  return v && v.trim() !== "" ? v.trim() : undefined;
};

export const config: AppConfig = {
  databaseUrl: str("DATABASE_URL"),
  googleServiceAccountJson: str("GOOGLE_SERVICE_ACCOUNT_JSON"),
  googleSheetId: str("GOOGLE_SHEET_ID"),
  instagramAccessToken: str("INSTAGRAM_ACCESS_TOKEN"),
  instagramUserId: str("INSTAGRAM_USER_ID"),
  instagramAccountId: str("INSTAGRAM_ACCOUNT_ID"),
  appBaseUrl: str("APP_BASE_URL") ?? "http://localhost:3100",
  port: Number(str("PORT") ?? "3100") || 3100,
};

const ENV_KEY_BY_CONFIG_KEY: Record<keyof AppConfig, string> = {
  databaseUrl: "DATABASE_URL",
  googleServiceAccountJson: "GOOGLE_SERVICE_ACCOUNT_JSON",
  googleSheetId: "GOOGLE_SHEET_ID",
  instagramAccessToken: "INSTAGRAM_ACCESS_TOKEN",
  instagramUserId: "INSTAGRAM_USER_ID",
  instagramAccountId: "INSTAGRAM_ACCOUNT_ID",
  appBaseUrl: "APP_BASE_URL",
  port: "PORT",
};

/**
 * Throw a descriptive error listing every requested var that is unset.
 * Call it from a server function / startup path right before a feature needs
 * its credentials, e.g. `requireEnv("googleSheetId")` at the top of
 * `fetchSheetRows()` once the integration lands.
 */
export function requireEnv(...keys: (keyof AppConfig)[]): void {
  const missing = keys.filter((k) => config[k] === undefined || config[k] === "");
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing
        .map((k) => ENV_KEY_BY_CONFIG_KEY[k])
        .join(", ")}. See .env.example.`,
    );
  }
}
