// Full-window downgrade refusal (R16-BP data-dir upgrade safety): rendered
// only when the packaged daemon refused to start because a newer Drogon
// build already migrated the data dir forward. The main process forwards the
// daemon's own refusal line plus the data dir through the renderer URL query
// (`?dataDirRefusal=<json>`), so this component needs no new preload/IPC
// surface. Copy is minimal and actionable: name the directory, keep using
// the previous build (the installer keeps it at /Applications/Drogon.app.previous),
// or restore a pre-migration backup; data is never touched by the refusal
// itself (the refusing build exits before migrating anything).
import { AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/button";

export type DataDirRefusal = {
  dataDir: string;
  reason: string;
};

/** Parses the `dataDirRefusal` query param; null when absent or malformed. */
export function readDataDirRefusalFromLocation(
  search: string,
): DataDirRefusal | null {
  const raw = new URLSearchParams(search).get("dataDirRefusal");
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as DataDirRefusal).dataDir === "string" &&
      typeof (value as DataDirRefusal).reason === "string"
    ) {
      return value as DataDirRefusal;
    }
  } catch {
    // fall through
  }
  return null;
}

export function DataDirRefusalOverlay({
  refusal,
}: {
  refusal: DataDirRefusal;
}): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6"
      data-dadir-refusal-overlay=""
    >
      <div
        className="flex w-full max-w-[520px] flex-col gap-4 rounded-md border border-border bg-card px-5 py-5 text-card-foreground shadow-xs"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="datadir-refusal-title"
        aria-describedby="datadir-refusal-body"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
          <h1 id="datadir-refusal-title" className="text-sm font-semibold">
            Drogon can&rsquo;t open this data directory
          </h1>
        </div>
        <div
          id="datadir-refusal-body"
          className="flex flex-col gap-3 text-sm text-muted-foreground"
        >
          <p>{refusal.reason}</p>
          <p>
            Your projects, sessions and settings are safe — this build
            stopped before changing anything.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              Quit Drogon and reopen your previous build
              {refusal.dataDir ? " to keep working" : ""}.
            </li>
            <li>
              To recover, restore the newest folder under{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                backups
              </code>{" "}
              in the data directory.
            </li>
          </ol>
          <p className="break-all text-xs">
            Data directory:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {refusal.dataDir}
            </code>
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => window.close()}>
            Quit Drogon
          </Button>
        </div>
      </div>
    </div>
  );
}
