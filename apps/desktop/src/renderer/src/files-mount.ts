// V2-owned mount adapter for the V3 files panel (handoff "Rutas y paneles").
// Mirrors the relayed V3 seam (features/workspaces/files-panel.tsx exporting
// FILES_ROUTE_ID/createFilesPanelDescriptor({bridge})/isFilesAvailable)
// WITHOUT importing any V3 file: this module is built against the real
// shared contract (FileBridge, FILES_CAPABILITY) and the V2
// route-panel-contract only. V3 corrections are still active, so nothing
// here is wired into App.tsx yet.
//
// Next step (explicit, once the V3 commit is stable): replace the local
// seam below with ONE import swap to the real V3 factory
// (`import { createFilesPanelDescriptor, FILES_ROUTE_ID as V3_FILES_ROUTE_ID }
// from "../features/workspaces/files-panel"`) and register its descriptor in
// App.tsx via this module's registerFilesRoute path — the single App mount
// stays V2-owned.

import type { ReactNode } from "react";
import { FILES_CAPABILITY } from "../../shared/file-contract";
import type { FileBridge } from "../../shared/file-contract";
import {
  registerRoute,
  routeId,
} from "./route-panel-contract";
import type { PanelDescriptor, PanelProps, RouteRegistry } from "./route-panel-contract";

/** Route id under which the files panel mounts; matches the relayed V3 constant. */
export const FILES_ROUTE_ID = routeId("files.explorer");

/** True iff the running service advertises files.v1. */
export function isFilesAvailable(capabilities: readonly string[]): boolean {
  return capabilities.includes(FILES_CAPABILITY);
}

/**
 * Seam the real V3 factory will satisfy directly:
 * createFilesPanelDescriptor({ bridge: FileBridge }) -> PanelDescriptor.
 * Kept as a type so the swap is a one-import change with no signature drift.
 */
export type FilesPanelFactory = (input: {
  bridge: FileBridge;
}) => PanelDescriptor;

/**
 * Registers the files route (capability-gated on files.v1) through the V2
 * contract and returns the new registry. Duplicate ids and unknown capability
 * gates are rejected by registerRoute itself.
 */
export function registerFilesRoute(
  registry: RouteRegistry,
  component: (props: PanelProps) => ReactNode,
): RouteRegistry {
  return registerRoute(registry, {
    id: FILES_ROUTE_ID,
    title: "Files",
    component,
    capability: FILES_CAPABILITY,
  });
}
