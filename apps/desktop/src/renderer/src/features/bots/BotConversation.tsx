/* MIT Copyright (c) 2026 Lovecast Inc. New for this repo: the reference
   fork (src/renderer/src/components/bots/*) has no chat-turn conversation
   view -- its "history" is responsibility-run history, not a chat
   transcript (see BotResponsibilityCard.tsx). This composes onto the
   existing session.read path (features/shell's live/idle/exited convention)
   instead of porting anything. */

import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import type {
  BotBridge,
  BotMessage,
  BotScope,
  BotSessionReader,
} from "../../../../shared/bot-contract";
import { buildBotRunHarness } from "./bots-page-model";

/** Renders PTY output as plain text: strips ANSI/VT escape sequences (CSI,
 *  OSC, charset selects) the harness TUI emits, drops carriage returns from
 *  spinner redraws, and collapses consecutive duplicate lines so a status
 *  line redrawn fifty times reads once. Display-only -- the raw bytes stay
 *  in the session buffer. */
export function readableTerminalText(raw: string): string {
  const stripped = raw
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][0-9A-Z]/g, "")
    .replace(/\r/g, "");
  const lines = stripped.split("\n");
  const collapsed: string[] = [];
  for (const line of lines) {
    if (
      collapsed.length > 0 &&
      collapsed[collapsed.length - 1] === line &&
      line.trim() !== ""
    ) {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed.join("\n");
}

function decodeBase64Utf8(base64: string): string {
  if (base64.length === 0) return "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

type ReplyState =
  | { status: "loading" }
  | { status: "unavailable" }
  | {
      status: "ready";
      text: string;
      verdict: "live" | "unverifiable" | "exited";
    };

function ReplyView({
  message,
  sessionReader,
}: {
  message: BotMessage;
  sessionReader?: BotSessionReader;
}) {
  const [state, setState] = useState<ReplyState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sessionReader || !message.sessionId || !message.incarnation) {
        setState({ status: "unavailable" });
        return;
      }
      // A harness process can still be writing its reply just after
      // dispatch; poll briefly rather than reading once, stopping as soon
      // as there is output or the session is no longer live.
      for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
        const response = await sessionReader({
          sessionId: message.sessionId,
          incarnation: message.incarnation,
          cursor: 0,
        });
        if (cancelled) return;
        if (!response.ok) {
          setState({ status: "unavailable" });
          return;
        }
        // PTY bytes carry the harness TUI's escape sequences; render the
        // readable text (raw bytes stay in the session buffer).
        const text = readableTerminalText(
          decodeBase64Utf8(response.result.dataBase64),
        );
        const verdict = response.result.session.verdict;
        setState({ status: "ready", text, verdict });
        if (text.trim() || verdict !== "live") return;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionReader, message.sessionId, message.incarnation]);

  if (message.error && !message.sessionId) {
    return (
      <p className="text-xs text-destructive">
        Not dispatched: {message.error}
      </p>
    );
  }
  if (state.status === "loading") {
    return <p className="text-xs text-muted-foreground">Reading reply…</p>;
  }
  if (state.status === "unavailable") {
    return (
      <p className="text-xs text-muted-foreground">
        Observed liveness:{" "}
        {message.hostObservation ?? "unverifiable (no session reader)"}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap text-sm text-foreground">
        {state.text.trim() || "(no output yet)"}
      </p>
      <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        Observed liveness: {state.verdict}
      </p>
    </div>
  );
}

export function BotConversation({
  botId,
  harnessId,
  explicitModel,
  scope,
  bridge,
  sessionReader,
}: {
  botId: string;
  /** The bot's own `harnessPolicy.defaultHarness` -- `bot.run` requires an
   *  admitted harness override on every call, chat turns included; no
   *  default resolution exists. */
  harnessId: string;
  /** The bot's own `harnessPolicy.explicitModel`, split into
   *  provider/model overrides at send time so a Pi bot runs its stored
   *  local model instead of Pi defaults. */
  explicitModel?: string | null;
  scope: BotScope & { locale: string };
  bridge: BotBridge;
  sessionReader?: BotSessionReader;
}) {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setLoadError(null);
    // botHistory's schema has no `locale` field (native's bot.history has no
    // use for it) -- spreading the full scope (which carries locale, for
    // bot.snapshot/bot.run) would fail its strict validation.
    const response = await bridge.botHistory?.({
      hostId: scope.hostId,
      workspaceId: scope.workspaceId,
      botId,
      limit: 50,
    });
    if (!response) {
      setLoadError("This bridge does not support Bot history.");
      setLoading(false);
      return;
    }
    if (!response.ok) {
      setLoadError(response.error.message);
      setLoading(false);
      return;
    }
    setMessages(response.result.messages);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    // Reload whenever the selected bot changes; not on every scope object
    // identity change (scope is a fresh object per render upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botId]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || sending) return;
    setSending(true);
    setSendError(null);
    const response = await bridge.botRun?.({
      ...scope,
      botId,
      prompt,
      harness: buildBotRunHarness(harnessId, explicitModel ?? null),
      requestId:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `bot-chat-${Date.now()}`,
    });
    setSending(false);
    if (!response) {
      setSendError("This bridge does not support running a Bot.");
      return;
    }
    if (!response.ok) {
      setSendError(response.error.message);
      return;
    }
    if (response.result.outcome !== "dispatched") {
      setSendError(response.result.error ?? `Run ${response.result.outcome}.`);
      return;
    }
    setDraft("");
    await refresh();
  }

  // Native returns newest-first; a conversation reads oldest-to-newest.
  const ordered = [...messages].reverse();

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-background p-3"
      data-testid={`bot-conversation-${botId}`}
    >
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        Conversation
      </h4>
      {loading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {!loading && !loadError && ordered.length === 0 && (
        <p className="text-xs text-muted-foreground">No messages yet.</p>
      )}
      <ul className="flex flex-col gap-3">
        {ordered.map((message) => (
          <li
            key={message.id}
            className="flex flex-col gap-2"
            data-testid="bot-conversation-turn"
          >
            <div className="rounded-md bg-accent px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                You
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {message.prompt}
              </p>
            </div>
            <div className="rounded-md border border-border px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                Bot
              </p>
              <ReplyView message={message} sessionReader={sessionReader} />
            </div>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="min-h-16 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          value={draft}
          placeholder="Send a message to this bot…"
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Message"
        />
        <Button type="submit" disabled={sending || draft.trim().length === 0}>
          {sending ? "Sending…" : "Send"}
        </Button>
      </form>
      {sendError && <p className="text-xs text-destructive">{sendError}</p>}
    </div>
  );
}

export default BotConversation;
