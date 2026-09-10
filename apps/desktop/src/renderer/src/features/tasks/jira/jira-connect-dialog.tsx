// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/jira-connect-dialog.tsx — the instance-type
// and auth-method toggle groups, field labels/placeholders, the clean-slate
// open effect, the mode-switch credential clearing and the submit flow are
// the fork's; the store's connectJira maps to this repo's JiraBridge
// jiraConnect, the remote-runtime storage copy has no Drogon counterpart
// (the daemon stores the site in its data dir), and the token deep link
// opens through this repo's shell seam.
import { useId, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, Lock } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../../../components/ui/toggle-group";
import { cn } from "../cn";
import type { JiraAuthType, JiraBridge } from "../../../../../shared/jira-contract";

type JiraConnectDialogProps = {
  bridge: JiraBridge;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
  overlayClassName?: string;
  contentClassName?: string;
};

type ConnectState = "idle" | "connecting" | "error";
type JiraInstanceType = "cloud" | "server";
// Self-hosted Jira accepts either a personal access token (Bearer) or classic
// username + password (Basic); older Server/DC instances predate PATs.
type ServerAuthMethod = "pat" | "basic";

export function TaskPageJiraConnectDialog({
  bridge,
  open,
  onOpenChange,
  onConnected,
  overlayClassName,
  contentClassName,
}: JiraConnectDialogProps): React.JSX.Element {
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const siteUrlId = useId();
  const emailId = useId();
  const tokenId = useId();
  const errorId = useId();

  const [instanceType, setInstanceType] = useState<JiraInstanceType>("cloud");
  const [serverAuthMethod, setServerAuthMethod] = useState<ServerAuthMethod>("pat");
  const [siteUrl, setSiteUrl] = useState("");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [connectState, setConnectState] = useState<ConnectState>("idle");
  const [connectError, setConnectError] = useState<string | null>(null);

  // Start every open with a clean slate so a previously-typed secret, stale
  // instance/auth-method selection, or old error can't linger across reopens.
  // Runs before paint so a stale credential never renders for a frame.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    setInstanceType("cloud");
    setServerAuthMethod("pat");
    setSiteUrl("");
    setEmail("");
    setApiToken("");
    setConnectState("idle");
    setConnectError(null);
  }, [open]);

  const isServer = instanceType === "server";
  // `needsIdentity` folds "Cloud Atlassian email" and "self-hosted Basic
  // username" — the identity slot that keys/labels the stored site. PAT auth
  // uses no identity, so the email field is hidden and left empty.
  const isServerBasic = isServer && serverAuthMethod === "basic";
  const needsIdentity = !isServer || isServerBasic;
  const canSubmit =
    Boolean(siteUrl.trim()) &&
    (!needsIdentity || Boolean(email.trim())) &&
    Boolean(apiToken.trim()) &&
    connectState !== "connecting";
  // Why: the fork branches on a remote provider runtime; Drogon's daemon
  // always stores the site in its local data dir, so the local copy is the
  // only truthful one.
  const credentialStorageCopy =
    "Your token is stored locally and encrypted when local runtime storage supports it.";

  const clearErrorOnEdit = (): void => {
    if (connectState === "error") {
      setConnectState("idle");
      setConnectError(null);
    }
  };

  // A Cloud email, a Server username, a PAT, and an account password are
  // different secrets; drop the credential fields when the deployment or auth
  // method changes so one can't be submitted as another (e.g. a password
  // silently riding along as a Bearer PAT).
  const clearCredentialsOnModeSwitch = (): void => {
    setEmail("");
    setApiToken("");
    clearErrorOnEdit();
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (connectState !== "connecting") {
      onOpenChange(nextOpen);
    }
  };

  const handleConnect = async (): Promise<void> => {
    const trimmedSite = siteUrl.trim();
    const trimmedEmail = email.trim();
    const trimmedToken = apiToken.trim();
    if (
      !trimmedSite ||
      (needsIdentity && !trimmedEmail) ||
      !trimmedToken ||
      connectState === "connecting"
    ) {
      return;
    }
    setConnectState("connecting");
    setConnectError(null);
    try {
      const result = await bridge.jiraConnect({
        siteUrl: trimmedSite,
        // Cloud sends the Atlassian email; self-hosted Basic sends the username;
        // PAT sends nothing, so a stale email can't key/label the stored site.
        email: needsIdentity ? trimmedEmail : "",
        apiToken: trimmedToken,
        authType: instanceType as JiraAuthType,
      });
      if (!mountedRef.current) {
        return;
      }
      if (result.ok) {
        setSiteUrl("");
        setEmail("");
        setApiToken("");
        setInstanceType("cloud");
        setServerAuthMethod("pat");
        setConnectState("idle");
        onOpenChange(false);
        onConnected?.();
        return;
      }
      setConnectState("error");
      setConnectError(result.error.message);
    } catch (error) {
      if (mountedRef.current) {
        setConnectState("error");
        setConnectError(error instanceof Error ? error.message : "Connection failed");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        overlayClassName={overlayClassName}
        className={cn("sm:max-w-md", contentClassName)}
      >
        <DialogHeader className="gap-3">
          <DialogTitle className="leading-tight">Connect Jira site</DialogTitle>
          <DialogDescription>
            {!isServer
              ? "Use a Jira Cloud site URL, Atlassian email, and API token to browse issues."
              : isServerBasic
                ? "Use a self-hosted Jira base URL, username, and password to browse issues."
                : "Use a self-hosted Jira base URL and a personal access token to browse issues."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleConnect();
          }}
        >
          <div className="flex flex-col gap-3">
            <ToggleGroup
              type="single"
              variant="outline"
              value={instanceType}
              disabled={connectState === "connecting"}
              onValueChange={(value) => {
                if (!value || connectState === "connecting") {
                  return;
                }
                setInstanceType(value as JiraInstanceType);
                clearCredentialsOnModeSwitch();
              }}
              aria-label="Jira instance type"
            >
              <ToggleGroupItem value="cloud" className="h-8 px-3 text-xs">
                Atlassian Cloud
              </ToggleGroupItem>
              <ToggleGroupItem value="server" className="h-8 px-3 text-xs">
                Self-hosted
              </ToggleGroupItem>
            </ToggleGroup>
            {isServer ? (
              <ToggleGroup
                type="single"
                variant="outline"
                value={serverAuthMethod}
                disabled={connectState === "connecting"}
                onValueChange={(value) => {
                  if (!value || connectState === "connecting") {
                    return;
                  }
                  setServerAuthMethod(value as ServerAuthMethod);
                  clearCredentialsOnModeSwitch();
                }}
                aria-label="Jira authentication method"
              >
                <ToggleGroupItem value="pat" className="h-8 px-3 text-xs">
                  Personal access token
                </ToggleGroupItem>
                <ToggleGroupItem value="basic" className="h-8 px-3 text-xs">
                  Username & password
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={siteUrlId} className="text-xs">
                {isServer ? "Jira site URL" : "Jira Cloud site URL"}
              </Label>
              <Input
                id={siteUrlId}
                autoFocus
                placeholder={
                  isServer ? "https://jira.example.com" : "https://example.atlassian.net"
                }
                value={siteUrl}
                onChange={(event) => {
                  setSiteUrl(event.target.value);
                  clearErrorOnEdit();
                }}
                disabled={connectState === "connecting"}
                // Why: URLs are identifiers, not prose.
                spellCheck={false}
              />
            </div>
            {needsIdentity ? (
              <div className="space-y-2">
                <Label htmlFor={emailId} className="text-xs">
                  {isServerBasic ? "Username" : "Atlassian email"}
                </Label>
                <Input
                  id={emailId}
                  type={isServerBasic ? "text" : "email"}
                  placeholder={isServerBasic ? "username" : "you@example.com"}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearErrorOnEdit();
                  }}
                  disabled={connectState === "connecting"}
                  // Why: usernames/emails are identifiers, not prose.
                  spellCheck={false}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={tokenId} className="text-xs">
                {isServerBasic
                  ? "Password"
                  : isServer
                    ? "Personal access token"
                    : "API token"}
              </Label>
              <Input
                id={tokenId}
                type="password"
                placeholder={
                  isServerBasic
                    ? "Jira account password"
                    : isServer
                      ? "Jira personal access token"
                      : "Atlassian API token"
                }
                value={apiToken}
                onChange={(event) => {
                  setApiToken(event.target.value);
                  clearErrorOnEdit();
                }}
                disabled={connectState === "connecting"}
                aria-invalid={connectState === "error"}
                aria-describedby={connectState === "error" ? errorId : undefined}
              />
            </div>
            {connectState === "error" && connectError ? (
              <p id={errorId} className="text-xs text-destructive">
                {connectError}
              </p>
            ) : null}
            {isServerBasic ? (
              <p className="text-xs text-muted-foreground">
                Use your Jira Server or Data Center account username and password.
              </p>
            ) : isServer ? (
              <p className="text-xs text-muted-foreground">
                Create a personal access token in your Jira profile under Personal
                Access Tokens.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Create a token in{" "}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    void windowShellOpenUrl(
                      "https://id.atlassian.com/manage-profile/security/api-tokens",
                    )
                  }
                >
                  Atlassian account settings
                </button>
                .
              </p>
            )}
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
              <Lock className="size-3 shrink-0" />
              {credentialStorageCopy}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={connectState === "connecting"}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {connectState === "connecting" ? (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The fork's `window.api.shell.openUrl` seam (tests/off-app no-op). */
function windowShellOpenUrl(url: string): Promise<unknown> | unknown {
  const drogon = (
    window as unknown as {
      drogon?: { shell?: { openExternal?: (url: string) => Promise<unknown> } };
    }
  ).drogon;
  return drogon?.shell?.openExternal?.(url);
}
