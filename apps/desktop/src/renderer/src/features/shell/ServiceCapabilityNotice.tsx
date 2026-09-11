/** Feature names the notice can name. `Meetings` is additive: the notes
 *  surface gates on meetings.v1 like the others. */
export type ServiceCapabilityFeature = "Bots" | "Agent settings" | "Meetings";

export function ServiceCapabilityNotice({ feature, connected = true }: {
  feature: ServiceCapabilityFeature;
  connected?: boolean;
}): React.JSX.Element {
  return (
    <div role="status" className="mx-auto max-w-lg text-sm leading-relaxed text-muted-foreground">
      {connected ? (
        <>
          <p>This service does not support {feature}. Nothing is restarted automatically.</p>
          <p className="mt-2">
            To update, use Restart daemon in Settings → Terminal. Confirming it stops every session.
          </p>
        </>
      ) : (
        <p>The service is not connected. Reconnect to use {feature}.</p>
      )}
    </div>
  );
}
