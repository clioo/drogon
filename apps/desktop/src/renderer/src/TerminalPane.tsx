import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalInputQueue } from "./terminal-input-queue";
import type { Session } from "../../shared/session-contract";

export function TerminalPane({
  session,
  onError,
  onSession,
}: {
  session: Session;
  onError(message: string): void;
  onSession(value: Session): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onError, onSession });
  callbacks.current = { onError, onSession };
  useEffect(() => {
    const surface = container.current!;
    const css = getComputedStyle(surface);
    const terminal = new Terminal({
      fontFamily: css.getPropertyValue("--font-mono"),
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      screenReaderMode: true,
      theme: {
        background: css.getPropertyValue("--background").trim(),
        foreground: css.getPropertyValue("--foreground").trim(),
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(surface);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      const theme = getComputedStyle(surface);
      terminal.options.theme = {
        background: theme.getPropertyValue("--background").trim(),
        foreground: theme.getPropertyValue("--foreground").trim(),
      };
    };
    scheme.addEventListener("change", updateTheme);
    let disposed = false;
    let cursor = 0;
    let timeout: ReturnType<typeof setTimeout>;
    let canWrite = session.verdict === "live";
    let lastObserved = session;
    const identity = {
      sessionId: session.id,
      incarnation: session.incarnation,
    };
    const report = (message: string) => {
      if (!disposed) callbacks.current.onError(message);
    };
    // Loss of contact is never proof of exit: a read failure or transport
    // error must not leave a stale "live" badge showing. Once exited is
    // positively observed, that stays authoritative — a later transport
    // hiccup does not un-exit a session that already reported its real end.
    const projectUnverifiable = () => {
      if (lastObserved.verdict === "exited") return;
      lastObserved = { ...lastObserved, verdict: "unverifiable" };
      callbacks.current.onSession(lastObserved);
    };
    const input = new TerminalInputQueue(
      (text) => window.drogon.write({ ...identity, text }),
      () => !disposed && canWrite,
      report,
    );
    const subscription = terminal.onData((text) => {
      void input.enqueue(text);
    });
    const fitTerminal = () => {
      if (disposed || surface.clientWidth === 0 || surface.clientHeight === 0)
        return;
      fit.fit();
    };
    const resize = terminal.onResize(({ cols, rows }) => {
      if (canWrite && !disposed)
        void window.drogon
          .resize({ ...identity, cols, rows })
          .then((result) => {
            if (!result.ok) report(result.error.message);
          })
          .catch(() => report("Terminal resize could not be confirmed."));
    });
    const observer = new ResizeObserver(fitTerminal);
    observer.observe(surface);
    fitTerminal();
    if (document.activeElement?.getAttribute("role") !== "tab")
      terminal.focus();
    async function read() {
      if (disposed) return;
      try {
        const response = await window.drogon.read({ ...identity, cursor });
        if (disposed) return;
        if (!response.ok) {
          canWrite = false;
          projectUnverifiable();
          report(response.error.message);
          return;
        }
        const value = response.result;
        if (value.truncated)
          terminal.write("\r\n[Earlier output is no longer retained]\r\n");
        const bytes = Uint8Array.from(atob(value.dataBase64), (char) =>
          char.charCodeAt(0),
        );
        await new Promise<void>((resolve) => terminal.write(bytes, resolve));
        if (disposed) return;
        cursor = value.nextCursor;
        canWrite = value.session.verdict === "live";
        lastObserved = value.session;
        callbacks.current.onSession(value.session);
        if (value.session.verdict === "exited" && bytes.length === 0) return;
        timeout = setTimeout(read, bytes.length === 65536 ? 0 : 120);
      } catch {
        canWrite = false;
        projectUnverifiable();
        report(
          "Terminal connection lost. Refresh to reconnect; process state is unverified.",
        );
      }
    }
    void read();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      scheme.removeEventListener("change", updateTheme);
      observer.disconnect();
      subscription.dispose();
      resize.dispose();
      terminal.dispose();
    };
  }, [session.id, session.incarnation]);
  return (
    <div
      ref={container}
      className="terminal-surface"
      aria-label="Session terminal"
    />
  );
}
