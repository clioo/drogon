// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P6: the restore control inside the downgrade-refusal
// overlay. This is the exact moment a restore is wanted — the daemon refused
// because the data dir is newer than this build — and the pre-migration
// backups on disk are the way back. Copy is honest by design: it names what
// will be overwritten, that the current state is snapshotted first, and that
// everything recorded after the backup's timestamp is lost. Never
// auto-restores: an explicit confirmation click, showing the timestamp, is
// required. The executor is the bundled `drogon-cli` via main's backups
// bridge (`windowBackupsBridge`); when the bridge is missing (an older
// preload) the manual CLI path is shown instead, never a dead button.
import React from "react";
import { ArchiveRestore } from "lucide-react";
import { Button } from "../../components/ui/button";
import type {
  BackupsBridge,
  BackupsListResult,
  BackupEntryInfo,
} from "../../../../shared/backups-contract";

/**
 * The granted `window.drogon.backups` namespace. DesktopBridge does not
 * declare it, so the cast lives here — one place — mirroring
 * `work-graph-mount.ts`'s `windowGraphBridge`. Returns null on builds whose
 * preload predates the namespace, so the overlay can render the manual path
 * instead of throwing.
 */
export function windowBackupsBridge(): BackupsBridge | null {
  const bridge = (
    window as unknown as { drogon?: { backups?: BackupsBridge } }
  ).drogon?.backups;
  return bridge ?? null;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function componentsLine(entry: BackupEntryInfo): string | null {
  if (entry.pendingMigrations.length === 0) return null;
  return entry.pendingMigrations
    .map((p) => `${p.component} v${p.recordedVersion}`)
    .join(", ");
}

type ControlState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "empty"; dataDir: string }
  | { kind: "listing"; dataDir: string; result: BackupsListResult }
  | {
      kind: "confirming";
      dataDir: string;
      result: BackupsListResult;
      entry: BackupEntryInfo;
    }
  | {
      kind: "restoring";
      dataDir: string;
      result: BackupsListResult;
      entry: BackupEntryInfo;
    }
  | { kind: "relaunching"; message: string };

export function BackupRestoreControl({
  dataDir,
  bridge = windowBackupsBridge(),
}: {
  dataDir: string;
  /** Injectable for tests; defaults to the real namespace. */
  bridge?: BackupsBridge | null;
}): React.JSX.Element {
  const [state, setState] = React.useState<ControlState>({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    if (!bridge) {
      setState({ kind: "unavailable" });
      return;
    }
    bridge.list().then((outcome) => {
      if (cancelled) return;
      if (outcome.ok && "list" in outcome) {
        const result = outcome.list;
        setState(
          result.backups.length === 0
            ? { kind: "empty", dataDir: result.dataDir }
            : { kind: "listing", dataDir: result.dataDir, result },
        );
        return;
      }
      setState({
        kind: "error",
        message: "error" in outcome ? outcome.error : "The backups could not be read.",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, dataDir]);

  const restore = (entry: BackupEntryInfo) => {
    if (!bridge) return;
    setState((current) =>
      current.kind === "confirming"
        ? { kind: "restoring", dataDir: current.dataDir, result: current.result, entry }
        : current,
    );
    bridge.restore(entry.id)
      .then((outcome) => {
        if (!(outcome.ok && "restore" in outcome))
          throw new Error(
            "error" in outcome ? outcome.error : "The restore was refused.",
          );
        return bridge.relaunchApp().then((relaunchOutcome) => {
          if (!relaunchOutcome.ok) throw new Error(relaunchOutcome.error);
        });
      })
      .then(() => {
        setState({
          kind: "relaunching",
          message: `Restored ${entry.id}. Drogon is relaunching against the restored data…`,
        });
      })
      .catch((error: unknown) => {
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "The restore was refused.",
        });
      });
  };

  return (
    <section
      className="flex flex-col gap-2.5 rounded-md border border-border bg-muted/40 px-3.5 py-3"
      data-backup-restore-control=""
      aria-label="Restore a pre-migration backup"
    >
      <div className="flex items-center gap-2">
        <ArchiveRestore className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">
          Restore a pre-migration backup
        </h2>
      </div>
      {state.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Looking for backups…</p>
      ) : null}
      {state.kind === "unavailable" ? (
        <ManualHint dataDir={dataDir} />
      ) : null}
      {state.kind === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "empty" ? (
        <p className="text-sm text-muted-foreground">
          This data directory has no pre-migration backups under{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            {state.dataDir}/backups
          </code>
          .
        </p>
      ) : null}
      {state.kind === "listing" ||
      state.kind === "confirming" ||
      state.kind === "restoring" ? (
        <BackupList
          state={state}
          onConfirm={(entry) =>
            state.kind !== "restoring" &&
            setState({
              kind: "confirming",
              dataDir: state.dataDir,
              result: state.result,
              entry,
            })
          }
          onCancel={() =>
            state.kind === "confirming" &&
            setState({
              kind: "listing",
              dataDir: state.dataDir,
              result: state.result,
            })
          }
          onRestore={restore}
        />
      ) : null}
      {state.kind === "relaunching" ? (
        <p className="text-sm text-foreground" role="status">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

function BackupList({
  state,
  onConfirm,
  onCancel,
  onRestore,
}: {
  state:
    | { kind: "listing"; dataDir: string; result: BackupsListResult }
    | { kind: "confirming"; dataDir: string; result: BackupsListResult; entry: BackupEntryInfo }
    | { kind: "restoring"; dataDir: string; result: BackupsListResult; entry: BackupEntryInfo };
  onConfirm: (entry: BackupEntryInfo) => void;
  onCancel: () => void;
  onRestore: (entry: BackupEntryInfo) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {state.result.backups.map((entry) => {
        const confirming =
          (state.kind === "confirming" || state.kind === "restoring") &&
          state.entry.id === entry.id;
        return (
          <div
            key={entry.id}
            className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2.5"
            data-backup-entry={entry.id}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-foreground">
                  Backup from {formatTimestamp(entry.createdAt)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(entry.sizeBytes)}
                  {componentsLine(entry)
                    ? ` · ${componentsLine(entry)}`
                    : ""}
                </span>
              </div>
              {entry.restorable ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.kind === "restoring"}
                  aria-expanded={confirming}
                  onClick={() => onConfirm(entry)}
                >
                  Restore…
                </Button>
              ) : (
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  title={entry.notRestorableReason ?? entry.invalidReason ?? undefined}
                >
                  {entry.notRestorableReason
                    ? "Newer than this build"
                    : "Unusable"}
                </span>
              )}
            </div>
            {entry.notRestorableReason ? (
              <p className="text-xs text-muted-foreground">
                {entry.notRestorableReason}
              </p>
            ) : null}
            {entry.invalidReason ? (
              <p className="text-xs text-muted-foreground">
                {entry.invalidReason}
              </p>
            ) : null}
            {confirming ? (
              <div
                className="mt-1 flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5"
                data-backup-confirm=""
                role="alertdialog"
                aria-label={`Confirm restoring the backup from ${formatTimestamp(state.entry.createdAt)}`}
              >
                <p className="text-sm text-foreground">
                  Restoring overwrites the current database in{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {state.dataDir}
                  </code>
                  .
                </p>
                <p className="text-sm text-foreground">
                  The current state is snapshotted first (a{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    pre-restore
                  </code>{" "}
                  folder), so this restore can itself be undone.
                </p>
                <p className="text-sm font-medium text-destructive">
                  Everything recorded after this backup&apos;s timestamp —{" "}
                  {formatTimestamp(state.entry.createdAt)} — will be lost.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={state.kind === "restoring"}
                    onClick={onCancel}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={state.kind === "restoring"}
                    onClick={() => onRestore(state.entry)}
                  >
                    {state.kind === "restoring"
                      ? "Restoring…"
                      : `Restore backup from ${formatTimestamp(state.entry.createdAt)}`}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ManualHint({ dataDir }: { dataDir: string }): React.JSX.Element {
  return (
    <p className="text-sm text-muted-foreground">
      To restore from a terminal, run{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-xs">
        drogon-cli backups list --data-dir &quot;{dataDir}&quot;
      </code>
      .
    </p>
  );
}
