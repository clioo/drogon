/* MIT Copyright (c) 2026 Lovecast Inc. Session-details content moved
   verbatim from App's inspector aside so the right sidebar can host it;
   markup and copy unchanged. */
import type { Session } from "../../../../shared/session-contract";

export function SessionDetailsPanel({
  terminal,
}: {
  terminal: Session | null;
}) {
  return (
    <aside className="session-details" aria-label="Session details">
      <h2>Session</h2>
      {terminal ? (
        <dl>
          <dt>Command</dt>
          <dd className="path">{terminal.command}</dd>
          <dt>State</dt>
          <dd>
            {terminal.verdict}
            {terminal.exitCode !== null ? ` · exit ${terminal.exitCode}` : ""}
          </dd>
          <dt>Execution host</dt>
          <dd className="path">{terminal.hostId}</dd>
          <dt>Session ID</dt>
          <dd className="path">{terminal.id}</dd>
        </dl>
      ) : (
        <p>Select a terminal to see its execution details.</p>
      )}
      <div className="migration-note">
        <h2>Coming in the migration</h2>
        <p>
          Mentu and Bots are not connected in this build. Source control is
          available from the Changes panel.
        </p>
      </div>
    </aside>
  );
}
