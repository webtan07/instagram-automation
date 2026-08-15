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
const STATUS_ORDER: ContentStatus[] = [
  "pending",
  "generating",
  "staged",
  "scheduled",
  "published",
  "failed",
];
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
function formatScheduledFor(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function Dashboard() {
  const snapshot = Route.useLoaderData() as PipelineSnapshot;
  const { pipeline, contentItems } = snapshot;
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
          and publishes on schedule. Pipeline state below comes straight from
          the database — the sheet import, asset generation and IG publishing
          integrations are still being wired up.
        </p>
      </header>
      {/* Status panel */}
      <section aria-label="Pipeline status" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#f8fafc]">
            Pipeline status
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              pipeline.schedulerRunning ? "chip-published" : "chip-pending"
            }`}
          >
            {pipeline.schedulerRunning ? "Scheduler running" : "Scheduler idle"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusCard label="Total" value={pipeline.total} accent />
          {STATUS_ORDER.map((status) => (
            <StatusCard
              key={status}
              label={STATUS_LABEL[status]}
              value={pipeline[status]}
            />
          ))}
        </div>
      </section>
      {/* Content table */}
      <section aria-label="Content pipeline">
        <h2 className="mb-3 text-lg font-semibold text-[#f8fafc]">
          Content pipeline
        </h2>
        {contentItems.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="text-3xl">📭</span>
            <p className="text-sm font-medium text-[#e2e8f0]">
              No content yet — connect Google Sheets to import your first row.
            </p>
            <p className="max-w-md text-xs text-[#64748b]">
              Once the Sheets integration lands, every imported row will appear
              here with its schedule and pipeline status.
            </p>
          </div>
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#1e2937] text-xs tracking-wide text-[#64748b] uppercase">
                  <th className="px-5 py-3 font-medium">ID</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Caption</th>
                  <th className="px-5 py-3 font-medium">Scheduled for</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e2937]">
                {contentItems.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="px-5 py-3.5 font-mono text-xs text-[#64748b]">
                      #{item.id}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block w-24 rounded-md px-2 py-1 text-center text-xs font-semibold ${TYPE_STYLES[item.type]}`}
                      >
                        {item.type}
                      </span>
                    </td>
                    <td className="max-w-xs px-5 py-3.5">
                      <p className="truncate text-[#e2e8f0]" title={item.caption}>
                        {item.caption}
                      </p>
                      {item.error && (
                        <p className="mt-1 text-xs text-[#f87171]">
                          {item.error}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs whitespace-nowrap text-[#94a3b8]">
                      {formatScheduledFor(item.scheduledFor)}
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${CHIP_STYLES[item.status]}`}
                      >
                        {STATUS_LABEL[item.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <footer className="mt-auto pt-10 text-xs text-[#475569]">
        Instagram Content Automation — pipeline state is live from Postgres.
        Integrations (Sheets, asset generation, IG API) are still stubbed with
        TODOs.
      </footer>
    </div>
  );
}
