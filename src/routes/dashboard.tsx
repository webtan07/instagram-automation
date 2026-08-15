import { createFileRoute } from "@tanstack/react-router";
import { getPipelineStatus } from "~/routes/api/pipeline";
import type { PipelineSnapshot } from "~/routes/api/pipeline";
import { DashboardView } from "~/components/dashboard-view";

// Alias of the "/" dashboard so the owner has a stable, memorable path
// (the WDA site's dashboard lives at /dashboard too).
export const Route = createFileRoute("/dashboard")({
  loader: () => getPipelineStatus(),
  component: DashboardPage,
});
function DashboardPage() {
  return <DashboardView snapshot={Route.useLoaderData() as PipelineSnapshot} />;
}
