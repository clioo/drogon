import { useCallback, useEffect, useState } from "react";
import type {
  AutomationBridge,
  AutomationRunView,
  AutomationSummary,
} from "../../../../shared/automation-contract";
import { automationInputSchemas } from "../../../../shared/automation-contract";
import type {
  Harness,
  Result,
  Status,
  Workspace,
} from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { previewCronFires } from "./automation-cron-preview";

export type AutomationsPanelProps = {
  bridge: AutomationBridge;
  workspace: Workspace;
  status: Status;
  listWorkspaces: () => Promise<Result<{ workspaces: Workspace[] }>>;
  listHarnesses: () => Promise<
    Result<{ hostId: string; harnesses: Harness[] }>
  >;
};

function formatTime(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return "—";
  return `${new Date(value).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

type FormState = {
  name: string;
  cron: string;
  workspaceId: string;
  harness: string;
  prompt: string;
  enabled: boolean;
  graceMinutes: string;
};

function blankForm(workspaceId: string): FormState {
  return {
    name: "",
    cron: "* * * * *",
    workspaceId,
    harness: "pi",
    prompt: "",
    enabled: true,
    graceMinutes: "15",
  };
}

function formOf(automation: AutomationSummary): FormState {
  return {
    name: automation.name,
    cron: automation.cron,
    workspaceId: automation.workspaceId ?? "",
    harness: automation.harness,
    prompt: automation.prompt,
    enabled: automation.enabled,
    graceMinutes: "15",
  };
}

export function AutomationsPanel({
  bridge,
  workspace,
  status,
  listWorkspaces,
  listHarnesses,
}: AutomationsPanelProps) {
  const [automations, setAutomations] = useState<AutomationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([workspace]);
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [editing, setEditing] = useState<
    { id: string } | { id: null } | null
  >(null);
  const [form, setForm] = useState<FormState>(() => blankForm(workspace.id));
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyFor, setHistoryFor] = useState<AutomationSummary | null>(null);
  const [history, setHistory] = useState<AutomationRunView[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [listed, workspaceResult, harnessResult] = await Promise.all([
        bridge.list(),
        listWorkspaces(),
        listHarnesses(),
      ]);
      if (!listed.ok) throw new Error(listed.error.message);
      setAutomations(listed.result.automations);
      if (workspaceResult.ok) setWorkspaces(workspaceResult.result.workspaces);
      if (harnessResult.ok)
        setHarnesses(
          harnessResult.result.harnesses.filter(
            (entry) => entry.availability === "available",
          ),
        );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not load automations.",
      );
    } finally {
      setLoading(false);
    }
  }, [bridge, listWorkspaces, listHarnesses]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = useCallback(() => {
    setForm(blankForm(workspace.id));
    setFormError("");
    setEditing({ id: null });
  }, [workspace.id]);

  const openEdit = useCallback((automation: AutomationSummary) => {
    setForm(formOf(automation));
    setFormError("");
    setEditing({ id: automation.id });
  }, []);

  const openHistory = useCallback(
    async (automation: AutomationSummary) => {
      setHistoryFor(automation);
      setHistory([]);
      setHistoryError("");
      setHistoryLoading(true);
      try {
        const result = await bridge.history({
          automationId: automation.id,
          limit: 50,
        });
        if (!result.ok) throw new Error(result.error.message);
        setHistory(result.result.runs);
      } catch (failure) {
        setHistoryError(
          failure instanceof Error ? failure.message : "Could not load history.",
        );
      } finally {
        setHistoryLoading(false);
      }
    },
    [bridge],
  );

  const save = useCallback(async () => {
    setFormError("");
    const grace = form.graceMinutes.trim() === "" ? undefined : Number(form.graceMinutes);
    if (grace !== undefined && (!Number.isFinite(grace) || grace < 0 || grace > 10_080)) {
      setFormError("Grace must be within 0..=10080 minutes.");
      return;
    }
    setSaving(true);
    try {
      if (editing?.id === null) {
        const parsed = automationInputSchemas.create.safeParse({
          name: form.name.trim(),
          cron: form.cron.trim(),
          workspaceId: form.workspaceId,
          harness: form.harness,
          prompt: form.prompt,
          enabled: form.enabled,
          ...(grace === undefined ? {} : { graceMinutes: grace }),
        });
        if (!parsed.success) throw new Error("Check the highlighted fields.");
        const created = await bridge.create(parsed.data);
        if (!created.ok) throw new Error(created.error.message);
      } else if (editing) {
        const parsed = automationInputSchemas.update.safeParse({
          id: editing.id,
          name: form.name.trim(),
          cron: form.cron.trim(),
          workspaceId: form.workspaceId || undefined,
          harness: form.harness,
          prompt: form.prompt,
          enabled: form.enabled,
          ...(grace === undefined ? {} : { graceMinutes: grace }),
        });
        if (!parsed.success) throw new Error("Check the highlighted fields.");
        const updated = await bridge.update(parsed.data);
        if (!updated.ok) throw new Error(updated.error.message);
      }
      setEditing(null);
      await refresh();
    } catch (failure) {
      setFormError(
        failure instanceof Error ? failure.message : "Could not save the automation.",
      );
    } finally {
      setSaving(false);
    }
  }, [bridge, editing, form, refresh]);

  const remove = useCallback(
    async (automation: AutomationSummary) => {
      if (
        !window.confirm(`Delete automation "${automation.name}" and its run history?`)
      )
        return;
      setError("");
      const result = await bridge.remove({ id: automation.id });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (historyFor?.id === automation.id) setHistoryFor(null);
      await refresh();
    },
    [bridge, historyFor, refresh],
  );

  const runNow = useCallback(
    async (automation: AutomationSummary) => {
      setRunningId(automation.id);
      setError("");
      try {
        const result = await bridge.runNow({ id: automation.id });
        if (!result.ok) throw new Error(result.error.message);
        await refresh();
        if (historyFor?.id === automation.id) await openHistory(automation);
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Could not run the automation.",
        );
      } finally {
        setRunningId(null);
      }
    },
    [bridge, historyFor, openHistory, refresh],
  );

  const toggleEnabled = useCallback(
    async (automation: AutomationSummary) => {
      setError("");
      const result = await bridge.update({
        id: automation.id,
        enabled: !automation.enabled,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await refresh();
    },
    [bridge, refresh],
  );

  const preview =
    editing !== null ? previewCronFires(form.cron, Date.now()) : null;

  return (
    <main className="flex h-full min-h-0 flex-col gap-4 bg-background p-5 text-foreground md:px-8" data-testid="automations-panel">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="truncate text-base font-semibold leading-8">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Cron schedules on {status.hostId}. Times are UTC.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Refresh automations"
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
          <Button size="sm" data-testid="automations-new" onClick={openCreate}>
            New Automation
          </Button>
        </div>
      </div>
      {error !== "" && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading automations…</p>
      ) : automations.length === 0 ? (
        <div className="rounded-md border border-border bg-background p-4" data-testid="automations-empty">
          <p className="text-sm">No automations on {status.hostId}.</p>
          <p className="text-sm text-muted-foreground">
            Create one to run a harness on a cron schedule in a workspace.
          </p>
        </div>
      ) : (
        <table className="text-sm" data-testid="automations-list">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Name</th>
              <th className="py-1 pr-3 font-medium">Schedule</th>
              <th className="py-1 pr-3 font-medium">Next run</th>
              <th className="py-1 pr-3 font-medium">Last run</th>
              <th className="py-1 pr-3 font-medium">Enabled</th>
              <th className="py-1 pr-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {automations.map((automation) => (
              <tr
                key={automation.id}
                data-testid={`automation-row-${automation.id}`}
                className="border-t border-border"
              >
                <td className="py-1 pr-3">{automation.name}</td>
                <td className="py-1 pr-3 font-mono text-muted-foreground">
                  {automation.cron}
                </td>
                <td className="py-1 pr-3 text-muted-foreground">
                  {formatTime(automation.nextRunAt)}
                </td>
                <td className="py-1 pr-3 text-muted-foreground">
                  {automation.lastRun
                    ? `${automation.lastRun.status} (${automation.lastRun.trigger})`
                    : "never"}
                </td>
                <td className="py-1 pr-3">
                  <input
                    type="checkbox"
                    aria-label={`Enabled for ${automation.name}`}
                    checked={automation.enabled}
                    onChange={() => void toggleEnabled(automation)}
                  />
                </td>
                <td className="flex gap-1 py-1 pr-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={runningId === automation.id}
                    onClick={() => void runNow(automation)}
                  >
                    Run now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void openHistory(automation)}
                  >
                    History
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(automation)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void remove(automation)}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing !== null && (
        <section
          aria-label={editing.id === null ? "New Automation" : "Edit Automation"}
          data-testid="automation-form"
          className="rounded-md border border-border bg-background p-4"
        >
          <h3 className="text-sm font-medium">
            {editing.id === null ? "New Automation" : "Edit Automation"}
          </h3>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <Input
                value={form.name}
                maxLength={128}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cron expression (UTC)
              <Input
                value={form.cron}
                className="font-mono"
                onChange={(event) => setForm({ ...form, cron: event.target.value })}
              />
              <span className="text-muted-foreground">
                Standard 5-field cron in UTC: minute hour day month weekday.
                Every minute is <span className="font-mono">* * * * *</span>.
              </span>
            </label>
            <div className="text-sm" data-testid="automations-preview">
              {preview === null ? (
                <span className="text-muted-foreground">
                  Next runs: preview unavailable for this expression.
                </span>
              ) : (
                <span>
                  Next runs:{" "}
                  {preview.map((fire) => formatTime(fire)).join(" · ")}
                </span>
              )}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Workspace
              <select
                className="rounded-md border border-input bg-background px-2 py-1"
                value={form.workspaceId}
                onChange={(event) =>
                  setForm({ ...form, workspaceId: event.target.value })
                }
              >
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Harness
              <select
                className="rounded-md border border-input bg-background px-2 py-1"
                value={form.harness}
                onChange={(event) => setForm({ ...form, harness: event.target.value })}
              >
                {(harnesses.length > 0
                  ? harnesses.map((entry) => entry.harnessId)
                  : ["claude", "pi", "opencode", "antigravity"]
                ).map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Prompt
              <textarea
                className="rounded-md border border-input bg-background px-2 py-1"
                rows={4}
                value={form.prompt}
                onChange={(event) => setForm({ ...form, prompt: event.target.value })}
              />
            </label>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                Enabled
              </label>
              <label className="flex items-center gap-2">
                Missed-run grace (minutes)
                <Input
                  className="w-24"
                  value={form.graceMinutes}
                  inputMode="decimal"
                  onChange={(event) =>
                    setForm({ ...form, graceMinutes: event.target.value })
                  }
                />
              </label>
            </div>
            {formError !== "" && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={saving} onClick={() => void save()}>
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </section>
      )}
      {historyFor !== null && (
        <aside
          aria-label={`Run history for ${historyFor.name}`}
          data-testid="automation-history"
          className="rounded-md border border-border bg-background p-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              History: {historyFor.name}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setHistoryFor(null)}>
              Close
            </Button>
          </div>
          {historyLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">Loading history…</p>
          ) : historyError !== "" ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {historyError}
            </p>
          ) : history.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No runs recorded.</p>
          ) : (
            <table className="mt-2 text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">Trigger</th>
                  <th className="py-1 pr-3 font-medium">Scheduled</th>
                  <th className="py-1 pr-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run) => (
                  <tr
                    key={run.id}
                    data-testid={`history-run-${run.id}`}
                    className="border-t border-border"
                  >
                    <td className="py-1 pr-3">{run.status}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{run.trigger}</td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {formatTime(run.scheduledFor)}
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {run.error ??
                        (run.exitCode !== null ? `exit=${run.exitCode}` : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </aside>
      )}
    </main>
  );
}
