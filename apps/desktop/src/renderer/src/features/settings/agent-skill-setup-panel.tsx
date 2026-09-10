// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/renderer/src/components/settings/AgentSkillSetupPanel.tsx
//   src/renderer/src/components/integration-status-pill.tsx
// Adapted data layer: Drogon's Settings has no inline setup terminal and no
// runtime skill-discovery service, so the Install/Update action copies the
// version-matched command (the reference's own copy-command affordance) for
// pasting into any terminal, and installed state comes from the bundled
// drogon-cli catalog plus the fixed home skill roots (window.drogon.skills).
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, RefreshCw, Terminal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";

type IntegrationStatusTone = "connected" | "attention" | "neutral";

const TONE_CLASSES: Record<IntegrationStatusTone, { pill: string; dot: string }> = {
  connected: {
    pill: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  attention: {
    pill: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  neutral: {
    pill: "border-border bg-background text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

/** Reference `IntegrationStatusPill`, verbatim classes. */
export function IntegrationStatusPill({
  tone,
  children,
}: {
  tone: IntegrationStatusTone;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASSES[tone].pill,
      )}
    >
      <span className={cn("size-1.5 rounded-full", TONE_CLASSES[tone].dot)} />
      {children}
    </span>
  );
}

export type AgentSkillTopic = {
  name: string;
  description: string;
  installed: boolean;
  installCommand: string;
  updateCommand: string;
};

export function AgentSkillSetupPanel({
  topic,
  title,
  description,
  installed,
  loading,
  error,
  className,
  onRecheck,
}: {
  topic: AgentSkillTopic;
  title: string;
  description: string;
  installed: boolean;
  loading: boolean;
  error: string | null;
  className?: string;
  onRecheck: () => void;
}): React.JSX.Element {
  // Reference: `installed ? (installedCommand ?? command) : command`.
  const activeCommand = installed ? topic.updateCommand : topic.installCommand;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyActiveCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activeCommand);
      setCopied(true);
      toast.success("Copied command.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to copy command.");
    }
  }, [activeCommand]);

  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-muted/20 p-5", className)}>
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-foreground">
          <Terminal className="size-5" />
        </div>
        <div className="min-w-0 flex-1 self-center">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h3>
            {loading && !installed ? (
              <IntegrationStatusPill tone="neutral">Checking...</IntegrationStatusPill>
            ) : installed ? (
              <IntegrationStatusPill tone="connected">Installed</IntegrationStatusPill>
            ) : (
              <IntegrationStatusPill tone="attention">Not installed</IntegrationStatusPill>
            )}
          </div>
          {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}
        </div>
      </div>
      <div className="mt-3 max-w-none">
        {description ? (
          <p className="text-[13px] leading-snug text-muted-foreground">{description}</p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyActiveCommand()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {installed ? "Update" : "Install"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onRecheck}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Re-check
          </Button>
          <p className="basis-full text-[12px] leading-snug text-muted-foreground">
            {installed ? "Update command" : "Install command"}: paste it into any terminal to{" "}
            {installed ? "refresh" : "install"} the skill for every agent on this host.
          </p>
        </div>
        <div className="mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-md border border-border bg-muted/35 px-3 py-2">
          <code className="scrollbar-sleek min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-muted-foreground">
            {activeCommand}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label="Copy command"
            onClick={() => void copyActiveCommand()}
          >
            <Copy className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Renderer access to the granted `window.drogon.skills.*` namespace; null
 *  where the preload bridge is absent (tests, older builds), so callers can
 *  degrade to an honest unavailable state. */
export function windowSkillsBridge(): {
  overview: () => Promise<unknown>;
} | null {
  try {
    const bridge = (
      window as unknown as { drogon?: { skills?: { overview: () => Promise<unknown> } } }
    ).drogon?.skills;
    return bridge ?? null;
  } catch {
    return null;
  }
}

/** Shared loader for the Settings "Agent skills" panels: one overview read
 *  feeds every panel, so the section never issues per-topic requests. */
export type SkillsOverviewState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; topics: AgentSkillTopic[] };

export async function loadSkillsOverview(): Promise<SkillsOverviewState> {
  const bridge = windowSkillsBridge();
  if (!bridge || typeof bridge.overview !== "function") {
    return { status: "unavailable", reason: "skills bridge is missing" };
  }
  try {
    const response = (await bridge.overview()) as {
      ok?: boolean;
      error?: { message?: string };
      result?: { available?: boolean; reason?: string | null; topics?: AgentSkillTopic[] };
    };
    if (!response?.ok || !response.result) {
      return {
        status: "unavailable",
        reason: response?.error?.message ?? "skills overview failed",
      };
    }
    if (!response.result.available) {
      return {
        status: "unavailable",
        reason: response.result.reason ?? "drogon-cli is unavailable",
      };
    }
    return { status: "ready", topics: response.result.topics ?? [] };
  } catch {
    return { status: "unavailable", reason: "skills overview failed" };
  }
}

export function SkillsLoadingRow(): React.JSX.Element {
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <Loader2 className="size-3.5 animate-spin" />
      Checking installed agent skills…
    </p>
  );
}
