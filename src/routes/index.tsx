import { createFileRoute } from "@tanstack/react-router";

import { getPipelineStatus } from "~/routes/api/pipeline";
import type { PipelineSnapshot } from "~/routes/api/pipeline";
import type { ContentStatus, ContentType } from "~/schema";

export const Route = createFileRoute("/")({
  loader: () => getPipelineStatus(),
  component: Dashboard,
});

// ── Presentational helpers ───────────────────────────────────────────────

const TYPE_STYLES: Record<ContentType, string> = {
  post: "bg-[#14243f] text-[#60a5fa]",
  carousel: "bg-[#231442] text-[#a78bfa]",
  reel: "bg-[#331426] text-[#f472b6]",
};

const STATUS_LABEL: Record<ContentStatus, string> = {
  pending: "Pending",
  generating: "Generating",
  staged: "Staged",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
};

const CHIP_STYLES: Record<ContentStatus, string> = {
  pending: "chip-pending",
  generating: "chip-generating",
  staged: "chip-staged",
  scheduled: "chip-scheduled",
  published: "chip-published",
  failed: "chip-failed",
};

function StatusCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`card flex flex-col gap-1 ${
        accent ? "border-[#ee2a7b]/40 shadow-glow" : ""
      }`}
    >
      <span className="text-xs font-medium tracking-wide text-[#64748b] uppercase">
        {label}
      </span>
      <span
        className={`text-3xl font-bold tabular-nums ${
          accent ? "text-gradient" : "text-[#f8fafc]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Dashboard() {
  const snapshot = Route.useLoaderData() as PipelineSnapshot;
  const { pipeline, scheduledContent } = snapshot;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
      {/* Header */}
      <header className="mb-8">
        <p className="text-sm font-semibold tracking-widest text-[#ee2a7b] uppercase">
          Web Digital Assistants · Internal Tool
        </p>
        <h1 className="text-gradient mt-1 text-3xl font-bold sm:text-4xl">
          Instagram Content Automation
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-[#94a3b8]">
          Reads content from a Google Sheet, renders posts / carousels / reels,
          and publishes on schedule. Scaffold — the panels below show sample
          data until the integrations land.
        </p>
      </header>

      {/* Status panel */}
      <section aria-label="Pipeline status" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#f8fafc]">Pipeline status</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              pipeline.schedulerRunning ? "chip-published" : "chip-pending"
            }`}
          >
            {pipeline.schedulerRunning ? "Scheduler running" : "Scheduler idle"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusCard label="Sheet rows" value={pipeline.sheetRows} accent />
          <StatusCard label="Pending" value={pipeline.pending} />
          <StatusCard label="Generating" value={pipeline.generating} />
          <StatusCard label="Staged" value={pipeline.staged} />
          <StatusCard label="Scheduled" value={pipeline.scheduled} />
          <StatusCard label="Published" value={pipeline.published} />
          <StatusCard label="Failed" value={pipeline.failed} />
          <div className="card flex flex-col justify-center gap-1">
            <span className="text-xs font-medium tracking-wide text-[#64748b] uppercase">
              Last sheet sync
            </span>
            <span className="text-sm text-[#cbd5e1]">
              {pipeline.lastSyncAt ?? "Never (stub)"}
            </span>
          </div>
        </div>
      </section>

      {/* Scheduled content list */}
      <section aria-label="Scheduled content">
        <h2 className="mb-3 text-lg font-semibold text-[#f8fafc]">
          Scheduled content
        </h2>
        <div className="card divide-y divide-[#1e2937] p-0">
          {scheduledContent.length === 0 && (
            <p className="p-5 text-sm text-[#94a3b8]">
              No content scheduled yet — rows from the sheet will appear here.
            </p>
          )}
          {scheduledContent.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 px-5 py-3.5"
            >
              <span
                className={`w-24 shrink-0 rounded-md px-2 py-1 text-center text-xs font-semibold ${TYPE_STYLES[item.type]}`}
              >
                {item.type}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[#e2e8f0]">{item.caption}</p>
                <p className="text-xs text-[#64748b]">
                  {new Date(item.scheduledFor).toLocaleString()}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${CHIP_STYLES[item.status]}`}
              >
                {STATUS_LABEL[item.status]}
              </span>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-auto pt-10 text-xs text-[#475569]">
        Instagram Content Automation — scaffold build. Integrations (Sheets,
        asset generation, IG API, DB migrations) are stubbed with TODOs.
      </footer>
    </div>
  );
}
