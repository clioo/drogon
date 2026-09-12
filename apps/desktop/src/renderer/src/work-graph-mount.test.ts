import { expect, it, vi } from "vitest";
import type { GraphBridge } from "../../shared/graph-contract";
import { createGatedGraphBridge } from "./work-graph-mount";

const methods = [
  "graphObservabilityStatus",
  "graphEvidenceAppend",
  "graphUsageAppend",
  "graphWritePolicy",
  "graphOrchestratorStart",
  "graphOrchestratorStatus",
  "graphOrchestratorStop",
  "graphOrchestratorResume",
] as const;

it.each(methods)(
  "forwards %s through the live capability gate",
  async (method) => {
    let allowed = true;
    const result = { ok: true, result: { run: null } };
    const call = vi.fn(async () => result);
    const source = { [method]: call } as unknown as GraphBridge;
    const mounted = createGatedGraphBridge(source, () => allowed);
    const input = { workspaceId: "ws" };
    const invoke = mounted[method] as (value: unknown) => Promise<unknown>;
    expect(await invoke(input)).toEqual(result);
    expect(call).toHaveBeenCalledExactlyOnceWith(input);
    allowed = false;
    expect(await invoke(input)).toMatchObject({
      ok: false,
      error: { code: "unsupported_capability" },
    });
    expect(call).toHaveBeenCalledTimes(1);
  },
);

it("keeps missing methods unavailable when an old preload is mounted", () => {
  const mounted = createGatedGraphBridge({} as GraphBridge, () => true);
  for (const method of methods) expect(mounted[method]).toBeUndefined();
});
