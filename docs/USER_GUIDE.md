# Instagram Content Automation — User Guide

This is your step-by-step workflow for using the app as an operator. The app
reads content from a **Google Sheet**, turns each row into a ready-to-post
**Instagram asset** (image post, carousel, or reel), and then — once Instagram
publishing is connected — posts them **on schedule**. Nothing here requires
touching code.

> **Live app:** https://instagram-automation-brown-five.vercel.app
> (dashboard is at `/` or `/dashboard`)

---

## 1. The pipeline at a glance

Every row in your sheet moves through these states:

```
Sheet row → Pending → Generating → Staged → [Scheduled → Published]
                │
                └──────────> Failed (if something went wrong — fix and Retry)
```

- **Pending** — imported from the sheet, nothing generated yet.
- **Generating** — the app is rendering your asset right now (a second or two).
- **Staged** — the asset is ready (image / carousel slides / reel).
- **Scheduled / Published** — only once Instagram publishing is wired up.

---

## 2. The Google Sheet — the only file you edit

Everything is driven by one spreadsheet. Each **row = one piece of content**.
The column headers are:

| Column | What goes in it | Required? |
|---|---|---|
| `content` | The caption / body copy of the post | ✅ yes |
| `type` | `post`, `carousel`, or `reel` | ✅ yes |
| `scheduled_for` | When it should go live (date + time) | no |
| `hashtags` | Space- or comma-separated hashtags (no `#` needed) | no |
| `image_url` | An optional pre-made image to use as the hero | no |

Examples:

- `5 tips to never miss a lead again` · `post` · `2026-08-20 09:00:00` · `#automation #smallbiz`
- `Why slow replies cost you sales` · `carousel` · `2026-08-22 09:00:00`
- `Quick tour of our automation` · `reel` · `2026-08-24 09:00:00`

If the sheet has no header row, the app writes the header for you the first
time you import.

---

## 3. Your workflow, step by step

1. **Open your Google Sheet** and add your content rows (one per post)
   using the columns above. You can edit the sheet any time.
2. **Go to the dashboard** — https://instagram-automation-brown-five.vercel.app
3. **Click "Import from Google Sheets"** (top of the page). The app pulls in
   every row, adds any new ones, and refreshes captions without resetting
   anything that already got generated. You'll see a summary like
   *"Imported 3, updated 0, skipped 0 · sheet rows 2–4"*.
4. **Click "Generate"** on each row that is **Pending** (or **Retry** on one
   that shows **Failed**). The row flips to *Generating*, then to **Staged**
   with a green check like *"✓ 1 asset staged"* (a carousel shows 3+ slides).
   - **Post** → 1 image (1080×1350)
   - **Carousel** → 3–6 images (1080×1350 each)
   - **Reel** → 1 video (1080×1920, ~15s)
5. **Repeat step 4 for every row** until all rows show **Staged**.
6. **Done for now.** When Instagram publishing is connected, this is where
   rows whose `scheduled_for` has arrived would automatically be posted — and
   their status would move to **Scheduled → Published**.

---

## 4. What the dashboard tells you

- **Pipeline status cards** — totals per state (Pending / Generating / Staged /
  Scheduled / Published / Failed). The header chip says **"Scheduler idle"**
  until publishing is wired up.
- **Content table** — one row per piece of content: ID, type, caption,
  scheduled time, status, and an action (*Generate* / *Retry* / stage count).
- **Errors** — if generation fails, the row shows a red **Failed** badge and
  the error text under the caption, so you know exactly what to fix.

---

## 5. If something looks wrong

- **A row shows Failed with an error** — read the error under the caption
  (e.g. a bad `image_url`), fix the sheet cell, re-import, and click **Retry**.
- **A row is missing after import** — make sure the sheet's `content` column
  isn't blank for that row (blank-content rows are skipped).
- **You changed a caption** — just re-import; it updates the row in place and
  you can generate again.
- **The dashboard is empty** — hit **Import from Google Sheets**; it says so
  right on the empty state.

---

## 6. Status of the feature set

| Capability | Status |
|---|---|
| Import from Google Sheet | ✅ Live |
| Generate post image | ✅ Live |
| Generate carousel | ✅ Live |
| Generate reel | ✅ Live |
| Dashboard (list + status + actions) | ✅ Live |
| Publish to Instagram on schedule | ⏳ Needs Meta account connection |
| Scheduler | ⏳ Ships with the above |

Good to know for the future: the generate step runs on a serverless function,
so generated files are *ephemeral* — the publish step is designed to render and
post in one pass, so no durable storage is required.

---

*Questions? The pipeline state on the dashboard is live from the database, so
what you see is always the current truth.*
