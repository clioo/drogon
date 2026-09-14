import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  MentuBridge,
  MentuRuntimeInfo,
  MentuRuntimeResult,
} from "../../../../shared/mentu-contract";
import type { Result } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { SettingsBadge } from "./SettingsFormControls";
import { SettingsRow, SettingsSubsectionHeader } from "./settings-rows";

export type MentuSettingsBridge = Pick<MentuBridge, "mentuRuntime"> & {
  mentuInstall?: () => Promise<Result<MentuRuntimeResult>>;
};

type RuntimeState =
  | { phase: "checking" }
  | { phase: "missing"; runtime: MentuRuntimeInfo }
  | { phase: "installed"; runtime: MentuRuntimeInfo }
  | { phase: "installing"; runtime: MentuRuntimeInfo }
  | {
      phase: "error";
      message: string;
      action: "check" | "install";
      runtime?: MentuRuntimeInfo;
    };

function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
}

function windowMentuBridge(): MentuSettingsBridge | null {
  try {
    return (
      (
        window as unknown as {
          drogon?: { mentu?: MentuSettingsBridge };
        }
      ).drogon?.mentu ?? null
    );
  } catch {
    return null;
  }
}

function stateFromResult(result: Result<MentuRuntimeResult>): RuntimeState {
  if (!result.ok)
    return { phase: "error", message: result.error.message, action: "check" };
  const runtime = result.result.runtime;
  if (runtime.available && runtime.lockMatches)
    return { phase: "installed", runtime };
  // Matching bytes with a failed executable probe means this host cannot run
  // the pinned binary (permissions, Gatekeeper or OS compatibility), not that
  // it is absent. Re-downloading the same bytes would make the Install button
  // misleading, so surface the daemon's actionable diagnostic and offer only
  // a status retry.
  if (runtime.lockMatches)
    return {
      phase: "error",
      message: runtime.message ?? "The installed Mentu runtime cannot run on this host.",
      action: "check",
      runtime,
    };
  return { phase: "missing", runtime };
}

function requestFailure(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Drogon could not reach the Mentu runtime service.";
}

export function MentuRuntimeSetting({
  bridge,
  isMac = isMacPlatform(),
}: {
  bridge?: MentuSettingsBridge | null;
  isMac?: boolean;
}): React.JSX.Element | null {
  const resolvedBridge = useMemo(
    () => (bridge === undefined ? windowMentuBridge() : bridge),
    [bridge],
  );
  const [state, setState] = useState<RuntimeState>({ phase: "checking" });

  const checkRuntime = useCallback(async () => {
    if (!resolvedBridge) {
      setState({
        phase: "error",
        message: "This Drogon build cannot check the Mentu runtime.",
        action: "check",
      });
      return;
    }
    setState({ phase: "checking" });
    try {
      setState(stateFromResult(await resolvedBridge.mentuRuntime()));
    } catch (error) {
      setState({
        phase: "error",
        message: requestFailure(error),
        action: "check",
      });
    }
  }, [resolvedBridge]);

  useEffect(() => {
    if (!isMac) return;
    let active = true;
    if (!resolvedBridge) {
      setState({
        phase: "error",
        message: "This Drogon build cannot check the Mentu runtime.",
        action: "check",
      });
      return;
    }
    void resolvedBridge
      .mentuRuntime()
      .then((result) => {
        if (active) setState(stateFromResult(result));
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            phase: "error",
            message: requestFailure(error),
            action: "check",
          });
      });
    return () => {
      active = false;
    };
  }, [isMac, resolvedBridge]);

  const installRuntime = useCallback(async () => {
    if (!resolvedBridge?.mentuInstall) {
      setState({
        phase: "error",
        message: "Update Drogon to install Mentu from Settings.",
        action: "check",
      });
      return;
    }
    const runtime =
      state.phase === "missing" || state.phase === "installing"
        ? state.runtime
        : state.phase === "error"
          ? state.runtime
          : undefined;
    if (!runtime) return;
    setState({ phase: "installing", runtime });
    try {
      const result = await resolvedBridge.mentuInstall();
      if (!result.ok) {
        setState({
          phase: "error",
          message: result.error.message,
          action: "install",
          runtime,
        });
        return;
      }
      setState({ phase: "installed", runtime: result.result.runtime });
    } catch (error) {
      setState({
        phase: "error",
        message: requestFailure(error),
        action: "install",
        runtime,
      });
    }
  }, [resolvedBridge, state]);

  if (!isMac) return null;

  const description = (() => {
    switch (state.phase) {
      case "checking":
        return "Checking installation…";
      case "installed":
        return state.runtime.version
          ? `Installed · ${state.runtime.version}`
          : "Installed and ready to run Mentu recipes.";
      case "installing":
        return "Downloading and verifying the pinned runtime…";
      case "error":
        return state.message;
      case "missing":
        return "Run Mentu recipes from Work Graph. Drogon downloads it only when you choose Install.";
    }
  })();

  const control = (() => {
    switch (state.phase) {
      case "installed":
        return <SettingsBadge tone="accent">Installed</SettingsBadge>;
      case "checking":
        return (
          <Button size="sm" variant="outline" disabled>
            Checking…
          </Button>
        );
      case "installing":
        return (
          <Button size="sm" disabled aria-label="Installing Mentu">
            Installing…
          </Button>
        );
      case "missing":
        return (
          <Button
            size="sm"
            onClick={() => void installRuntime()}
            disabled={!resolvedBridge?.mentuInstall}
          >
            Install
          </Button>
        );
      case "error":
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void (state.action === "install"
                ? installRuntime()
                : checkRuntime())
            }
          >
            Retry
          </Button>
        );
    }
  })();

  return (
    <div className="space-y-2 py-4" data-testid="mentu-runtime-setting">
      <SettingsSubsectionHeader
        title="Optional tools"
        description="Install extra local runtimes only when you need them."
      />
      <SettingsRow
        label="Mentu runtime"
        description={
          <span
            role={state.phase === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {description}
          </span>
        }
        control={control}
      />
    </div>
  );
}
