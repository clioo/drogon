import { useEffect, useState } from "react";
import type {
  GhAuthStatusResult,
  GitIdentityResult,
} from "../../../../shared/settings-contract";
import { windowSettingsBridge } from "./settings-bridge";
import { SettingsRow, SettingsSection } from "./settings-rows";

type ProbeState<T> =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; value: T };

function Unavailable({ reason }: { reason: string }) {
  return (
    <p role="status" className="settings-unavailable">
      Not available: {reason}
    </p>
  );
}

export function GitSection({
  workspacePath,
}: {
  /** Selected workspace path, or null when nothing is selected. */
  workspacePath: string | null;
}): React.JSX.Element {
  const [identity, setIdentity] = useState<ProbeState<GitIdentityResult>>({
    status: "loading",
  });
  const [gh, setGh] = useState<ProbeState<GhAuthStatusResult>>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    const bridge = windowSettingsBridge();
    if (!bridge) {
      setIdentity({ status: "unavailable", reason: "settings bridge is missing" });
      setGh({ status: "unavailable", reason: "settings bridge is missing" });
      return;
    }
    if (!workspacePath) {
      setIdentity({
        status: "unavailable",
        reason: "select a workspace to see its git identity",
      });
    } else {
      setIdentity({ status: "loading" });
      void bridge
        .gitIdentity({ workspacePath })
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setIdentity({ status: "unavailable", reason: result.error.message });
            return;
          }
          if (!result.result.available) {
            setIdentity({
              status: "unavailable",
              reason: result.result.reason ?? "git did not respond",
            });
            return;
          }
          setIdentity({ status: "ready", value: result.result });
        })
        .catch(() =>
          setIdentity({ status: "unavailable", reason: "git probe failed" }),
        );
    }
    setGh({ status: "loading" });
    void bridge
      .ghAuthStatus()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setGh({ status: "unavailable", reason: result.error.message });
          return;
        }
        if (!result.result.available) {
          setGh({ status: "unavailable", reason: result.result.output });
          return;
        }
        setGh({ status: "ready", value: result.result });
      })
      .catch(() =>
        setGh({ status: "unavailable", reason: "gh probe failed" }),
      );
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  return (
    <SettingsSection
      id="git"
      title="Git and GitHub"
      description="Read-only status from this Mac. Nothing here changes your repositories."
    >
      <h3 className="settings-subhead">Git identity</h3>
      {workspacePath ? (
        <p className="settings-note">{workspacePath}</p>
      ) : null}
      {identity.status === "loading" ? (
        <p role="status" className="settings-note">
          Reading git config…
        </p>
      ) : identity.status === "unavailable" ? (
        <Unavailable reason={identity.reason} />
      ) : (
        <>
          <SettingsRow
            label="Name"
            control={
              <span className="settings-value">
                {identity.value.name ?? "Not set"}
              </span>
            }
          />
          <SettingsRow
            label="Email"
            control={
              <span className="settings-value">
                {identity.value.email ?? "Not set"}
              </span>
            }
          />
        </>
      )}
      <h3 className="settings-subhead">GitHub CLI</h3>
      {gh.status === "loading" ? (
        <p role="status" className="settings-note">
          Running gh auth status…
        </p>
      ) : gh.status === "unavailable" ? (
        <Unavailable reason={gh.reason} />
      ) : (
        <>
          <SettingsRow
            label="Status"
            control={
              <span className="settings-value">
                {gh.value.loggedIn ? "Logged in" : "Not logged in"}
              </span>
            }
          />
          <pre className="settings-pre">{gh.value.output}</pre>
        </>
      )}
    </SettingsSection>
  );
}
