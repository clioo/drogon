// Mount adapter for the Work board: the route id, the capability gate and
// the granted bridge lookup (mirrors meetings-mount.ts).
import { WORK_CAPABILITY, type WorkBridge } from "../../shared/work-contract";
import { routeId } from "./route-panel-contract";

export const WORK_ROUTE_ID = routeId("work");
export const WORK_PAGE_HOST_TESTID = "work-page-host";
export { WORK_CAPABILITY };

export function isWorkAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(WORK_CAPABILITY);
}

export function windowWorkBridge(): WorkBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { drogon?: { work?: WorkBridge } }).drogon;
  return bridge?.work ?? null;
}
