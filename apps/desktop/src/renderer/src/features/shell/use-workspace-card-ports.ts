import { useEffect, useState } from "react";
import type { Workspace } from "../../../../shared/session-contract";
import type {} from "../../../../shared/usage-contract";

const EMPTY_PORTS: ReadonlyMap<string, readonly number[]> = new Map();

/** One host-wide scan for the entire sidebar, never one process scan per card.
 * Unknown/remote host ownership cannot be inferred from workspace identifiers. */
export function useWorkspaceCardPorts(workspaces: readonly Workspace[], enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ ownershipKey: string; ports: ReadonlyMap<string, readonly number[]> } | null>(null);
  const ownershipKey = JSON.stringify(workspaces.map(({ id, hostId }) => [id, hostId ?? null]));
  useEffect(() => {
    const setPorts = (ports: ReadonlyMap<string, readonly number[]>) => setSnapshot({ ownershipKey, ports });
    let cancelled = false;
    let timer: number | undefined;
    const bridge = window.drogon;
    if (!enabled || !bridge?.workspacePorts?.list || !bridge.status) {
      setPorts(new Map());
      return;
    }
    const identities = JSON.parse(ownershipKey) as [string, string | null][];
    async function scan() {
      try {
        const status = await bridge.status();
        if (cancelled) return;
        if (!status.ok) { setPorts(new Map()); return; }
        const localIds = new Set(identities.filter(([, host]) => host === status.result.hostId).map(([id]) => id));
        const workspaceId = localIds.values().next().value;
        if (!workspaceId) { setPorts(new Map()); return; }
        const snapshot = await bridge.workspacePorts.list({ workspaceId });
        if (cancelled) return;
        const next = new Map<string, number[]>();
        if (snapshot.ok && !snapshot.result.unavailableReason) {
          for (const row of snapshot.result.ports) {
            const owner = row.owner?.workspaceId;
            if (row.kind !== "workspace" || !owner || !localIds.has(owner)) continue;
            const values = next.get(owner) ?? [];
            if (!values.includes(row.port)) values.push(row.port);
            next.set(owner, values.sort((a, b) => a - b));
          }
        }
        setPorts(next);
      } catch {
        if (!cancelled) setPorts(new Map());
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void scan(), 10000);
      }
    }
    void scan();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, ownershipKey]);
  return enabled && snapshot?.ownershipKey === ownershipKey ? snapshot.ports : EMPTY_PORTS;
}
