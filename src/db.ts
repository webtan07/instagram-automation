import { neon } from "@neondatabase/serverless";

/**
 * Server-only handle to the app's database (Neon serverless Postgres over HTTP).
 * The connection string comes from `DATABASE_URL` (see .env.example). Resolved
 * lazily (per call, not at module load) so the app still builds and serves
 * before a database is connected — the error only surfaces if a query actually
 * runs without `DATABASE_URL`.
 *
 * Use it only inside a `createServerFn()` handler or an API route (never client
 * code):
 *
 *   const getItems = createServerFn().handler(async () => {
 *     const rows = await sql()`select id, caption, status from content_items`;
 *     // Coerce non-primitive columns (timestamps are JS Dates) to strings
 *     // before returning to the client, or React will refuse to render them.
 *     return rows.map((r) => ({ ...r, scheduled_for: String(r.scheduled_for) }));
 *   });
 */
export const sql = () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — copy .env.example to .env and add the Neon connection string before running queries.",
    );
  }
  return neon(url);
};
