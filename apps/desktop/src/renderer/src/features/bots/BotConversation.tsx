import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { BotDeliveryStatus } from "./BotDeliveryStatus";
import type {
  ConversationMessageView,
  ConversationView,
  DeliveryView,
} from "./bot-conversation-state";
import {
  describeNativeLiveness,
  formatContextLabel,
  formatRuntimeLabel,
} from "./bot-conversation-state";

function livenessBadge(liveness: ConversationView["liveness"]): string {
  if (!liveness) return "No session yet";
  if (liveness === "live") return "live";
  if (liveness === "exited") return "exited";
  return "unverifiable";
}

function messageDetail(message: ConversationMessageView): string {
  if (message.error) return message.error;
  if (message.hostObservation) return message.hostObservation;
  if (message.sessionId) return `session ${message.sessionId}`;
  return "Not yet dispatched";
}

export function BotConversation({
  conversation,
  messages,
  replies,
  deliveries,
  onOpen,
  onResume,
  onQueue,
  onSteer,
  onRetryDelivery,
  onReconcileDelivery,
}: {
  conversation: ConversationView | null;
  messages: ConversationMessageView[];
  /** Decoded reply text per message id, read by the caller through the
   *  existing `session.read` path. This component never fetches sessions
   *  itself and never stores transcripts. */
  replies: Record<string, string>;
  deliveries: DeliveryView[];
  onOpen?: () => void;
  onResume?: () => void;
  onQueue?: (prompt: string) => void;
  onSteer?: (prompt: string) => void;
  onRetryDelivery?: (deliveryId: string) => void;
  onReconcileDelivery?: (deliveryId: string, accepted: boolean) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [steerDraft, setSteerDraft] = useState("");
  const hasActiveTurn = messages.some(
    (message) => message.endedAt === null && !message.error,
  );

  if (!conversation) {
    return (
      <Card data-testid="bot-conversation-empty">
        <CardHeader>
          <CardTitle className="text-sm">Bot conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Open or resume the conversation for this Bot and project to see
            its runs here.
          </p>
          {onOpen ? (
            <Button
              size="sm"
              data-testid="bot-conversation-open"
              onClick={onOpen}
            >
              Open conversation
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const liveness = describeNativeLiveness({
    sessionId: conversation.nativeSessionId,
    observedVerdict: conversation.liveness ?? null,
  });

  return (
    <Card data-testid={`bot-conversation-${conversation.id}`}>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-sm">
              {conversation.botName ?? conversation.botId}
            </CardTitle>
            <p
              className="mt-1 truncate text-xs text-muted-foreground"
              data-testid={`bot-conversation-scope-${conversation.id}`}
            >
              {conversation.projectId} ·{" "}
              {formatRuntimeLabel(conversation)}
            </p>
            <p
              className="mt-1 text-xs text-muted-foreground"
              data-testid={`bot-conversation-context-${conversation.id}`}
            >
              {formatContextLabel(conversation)}
            </p>
          </div>
          <Badge variant="outline">{livenessBadge(conversation.liveness)}</Badge>
        </div>
        {liveness === "unverifiable" ? (
          <p className="mt-2 text-xs text-muted-foreground" role="note">
            The session link is stale — shown as unverifiable until a fresh
            read confirms it.
          </p>
        ) : null}
        {onResume ? (
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              data-testid={`bot-conversation-resume-${conversation.id}`}
              onClick={onResume}
            >
              Resume
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div
          className="space-y-3"
          role="list"
          aria-label="Conversation results"
          data-testid={`bot-conversation-messages-${conversation.id}`}
        >
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No runs yet in this conversation.
            </p>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                role="listitem"
                data-testid={`bot-conversation-message-${message.id}`}
                className="rounded-md border border-border px-3 py-2"
              >
                <p className="text-sm font-medium text-foreground">
                  {message.prompt}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {messageDetail(message)}
                  {message.sessionId && message.incarnation
                    ? ` · ${message.sessionId.slice(0, 8)}`
                    : ""}
                </p>
                {replies[message.id] ? (
                  <p
                    className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground"
                    data-testid={`bot-conversation-reply-${message.id}`}
                  >
                    {replies[message.id]}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
        {deliveries.length > 0 ? (
          <div className="space-y-2" aria-label="Delivery status">
            {deliveries.map((delivery) => (
              <BotDeliveryStatus
                key={delivery.id}
                delivery={delivery}
                onRetry={onRetryDelivery}
                onReconcile={onReconcileDelivery}
              />
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          <label
            className="text-xs font-medium text-foreground"
            htmlFor={`bot-conversation-queue-${conversation.id}`}
          >
            Queue input (waits for the active turn)
          </label>
          <div className="flex gap-2">
            <input
              id={`bot-conversation-queue-${conversation.id}`}
              data-testid={`bot-conversation-queue-input-${conversation.id}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Queue a follow-up"
            />
            <Button
              size="sm"
              variant="outline"
              data-testid={`bot-conversation-queue-send-${conversation.id}`}
              disabled={!draft.trim()}
              onClick={() => {
                if (draft.trim()) {
                  onQueue?.(draft);
                  setDraft("");
                }
              }}
            >
              Queue
            </Button>
          </div>
          <label
            className="text-xs font-medium text-foreground"
            htmlFor={`bot-conversation-steer-${conversation.id}`}
          >
            Steer active turn
          </label>
          <div className="flex gap-2">
            <input
              id={`bot-conversation-steer-${conversation.id}`}
              data-testid={`bot-conversation-steer-input-${conversation.id}`}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={steerDraft}
              onChange={(event) => setSteerDraft(event.target.value)}
              placeholder={
                hasActiveTurn ? "Steer the running turn" : "No active turn"
              }
              disabled={!hasActiveTurn}
            />
            <Button
              size="sm"
              variant="outline"
              data-testid={`bot-conversation-steer-send-${conversation.id}`}
              disabled={!hasActiveTurn || !steerDraft.trim()}
              onClick={() => {
                if (steerDraft.trim()) {
                  onSteer?.(steerDraft);
                  setSteerDraft("");
                }
              }}
            >
              Steer
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default BotConversation;
