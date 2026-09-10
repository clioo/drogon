import type { DeliveryView } from "./bot-conversation-state";
import {
  deliveryNeedsReconciliation,
  deliveryStatusLabel,
} from "./bot-conversation-state";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

function statusVariant(
  state: DeliveryView["state"],
): "default" | "outline" | "secondary" | "destructive" {
  switch (state) {
    case "delivered":
      return "default";
    case "pending":
      return "secondary";
    case "uncertain":
      return "outline";
    case "failed":
      return "destructive";
  }
}

function recoveryCopy(delivery: DeliveryView): string {
  switch (delivery.state) {
    case "pending":
      return "Waiting to send. Safe to attempt — nothing has left this device.";
    case "uncertain":
      return "Sent, but the acknowledgement is unknown. It was not resent and is not shown as delivered. Reconcile against the target or confirm with the user first.";
    case "delivered":
      return "The target acknowledged this result.";
    case "failed":
      return delivery.lastError ?? "The target refused this result.";
  }
}

export function BotDeliveryStatus({
  delivery,
  onRetry,
  onReconcile,
}: {
  delivery: DeliveryView;
  onRetry?: (deliveryId: string) => void;
  onReconcile?: (deliveryId: string, accepted: boolean) => void;
}): React.JSX.Element {
  const needsReconciliation = deliveryNeedsReconciliation(delivery);
  return (
    <div
      data-testid={`delivery-${delivery.id}`}
      className="rounded-md border border-border px-3 py-2"
      role="status"
      aria-label={`Delivery ${delivery.id}: ${deliveryStatusLabel(delivery.state)}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {delivery.id} · run {delivery.runId} · attempt {delivery.attempts}
        </span>
        <Badge variant={statusVariant(delivery.state)}>
          {deliveryStatusLabel(delivery.state)}
        </Badge>
      </div>
      <p className="mt-1 text-sm leading-6 text-foreground">
        {recoveryCopy(delivery)}
      </p>
      {needsReconciliation ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            data-testid={`delivery-reconcile-accepted-${delivery.id}`}
            onClick={() => onReconcile?.(delivery.id, true)}
          >
            Mark accepted
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid={`delivery-reconcile-refused-${delivery.id}`}
            onClick={() => onReconcile?.(delivery.id, false)}
          >
            Mark not accepted
          </Button>
        </div>
      ) : null}
      {delivery.state === "failed" ? (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            data-testid={`delivery-retry-${delivery.id}`}
            onClick={() => onRetry?.(delivery.id)}
          >
            Retry with approval
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default BotDeliveryStatus;
