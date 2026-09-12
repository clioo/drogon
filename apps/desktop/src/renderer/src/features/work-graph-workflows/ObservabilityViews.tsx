import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  FileText,
  Gauge,
} from "lucide-react";
import type { GraphObservabilitySnapshot } from "../../../../shared/graph-contract";
import { Badge } from "../../components/ui/badge";

function formatTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function EvidenceIcon({ status }: { status: string }): React.JSX.Element {
  if (status === "completed")
    return <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />;
  if (status === "blocked" || status === "failed")
    return <AlertCircle className="size-4 text-destructive" aria-hidden />;
  if (status === "finding")
    return <CircleDot className="size-4 text-amber-500" aria-hidden />;
  return <CircleDot className="size-4 text-muted-foreground" aria-hidden />;
}

export function EvidenceView({
  snapshot,
  loading,
}: {
  snapshot: GraphObservabilitySnapshot;
  loading: boolean;
}): React.JSX.Element {
  if (loading && snapshot.evidence.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading evidence…</div>
    );
  }
  if (snapshot.evidence.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-8 text-center"
        data-testid="work-graph-evidence-empty"
      >
        <div className="max-w-md">
          <FileText
            className="mx-auto size-8 text-muted-foreground"
            aria-hidden
          />
          <h2 className="mt-3 text-sm font-medium">No evidence recorded yet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Lead-agent checkpoints appear here as work advances. They are stored
            in <code>.drogon/evidence.json</code> and remain readable without
            Drogon.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-auto p-4"
      data-testid="work-graph-evidence-view"
    >
      <div className="mx-auto max-w-3xl space-y-3">
        {[...snapshot.evidence].reverse().map((entry) => (
          <article
            key={entry.id}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <EvidenceIcon status={entry.status} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium">{entry.summary}</h3>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {entry.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatTime(entry.timestamp)}
                  {entry.role ? ` · ${entry.role}` : ""}
                  {entry.agentId ? ` · ${entry.agentId}` : ""}
                </p>
                {entry.detail ? (
                  <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {entry.detail}
                  </p>
                ) : null}
                {entry.artifacts.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {entry.artifacts.map((artifact) => (
                      <code
                        key={artifact}
                        className="rounded bg-muted px-2 py-1 text-[11px]"
                      >
                        {artifact}
                      </code>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function sum(
  snapshot: GraphObservabilitySnapshot,
  key: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens",
): number | null {
  const values = snapshot.usage
    .map((entry) => entry[key])
    .filter((value): value is number => typeof value === "number");
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0);
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {value === null ? "—" : value.toLocaleString()}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {value === null ? "Not reported" : "Measured"}
      </p>
    </div>
  );
}

export function UsageView({
  snapshot,
  loading,
}: {
  snapshot: GraphObservabilitySnapshot;
  loading: boolean;
}): React.JSX.Element {
  const input = sum(snapshot, "inputTokens");
  const output = sum(snapshot, "outputTokens");
  const cacheRead = sum(snapshot, "cacheReadTokens");
  const cacheWrite = sum(snapshot, "cacheWriteTokens");
  const agents = new Set(
    snapshot.usage.map((entry) => entry.agentId).filter(Boolean),
  ).size;
  if (loading && snapshot.usage.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading usage…</div>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-auto p-4"
      data-testid="work-graph-usage-view"
    >
      <div className="mx-auto max-w-4xl">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Input tokens" value={input} />
          <Metric label="Output tokens" value={output} />
          <Metric label="Cache read" value={cacheRead} />
          <Metric label="Cache write" value={cacheWrite} />
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge className="size-4" aria-hidden />
          {snapshot.usage.length === 0
            ? "No agent has reported token usage yet. Missing usage is never counted as zero."
            : `${snapshot.usage.length} measurements across ${agents || "unidentified"} agent${agents === 1 ? "" : "s"}.`}
        </div>
        {snapshot.usage.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-border">
            {[...snapshot.usage].reverse().map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border p-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {entry.role ?? entry.agentId ?? "Agent"}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[entry.harness, entry.model].filter(Boolean).join(" / ") ||
                      "Runtime not reported"}
                    {entry.agentId && entry.role ? ` · ${entry.agentId}` : ""}
                  </p>
                </div>
                <div className="text-right text-[11px] tabular-nums text-muted-foreground">
                  <p>
                    ↑ {entry.inputTokens?.toLocaleString() ?? "—"} · ↓{" "}
                    {entry.outputTokens?.toLocaleString() ?? "—"}
                  </p>
                  <p>{formatTime(entry.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
