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
 * Plain descriptor shape the real V3 factory returns: a string id, NOT a
 * branded RouteId. The boundary below validates it; never loosen the
 * contract type to accept unvalidated strings.
 */
export type FactoryDescriptor = {
  id: string;
  title: string;
  component: (props: PanelProps) => ReactNode;
  capability?: string;
  restoreState?: unknown;
  onFocus?: (routeId: string) => void;
  onCleanup?: (routeId: string) => void;
};

/**
 * Seam the real V3 factory satisfies directly:
 * createFilesPanelDescriptor({ bridge: FileBridge }) -> FactoryDescriptor.
 */
export type FilesPanelFactory = (input: {
  bridge: FileBridge;
}) => FactoryDescriptor;

/**
 * Adapts a factory descriptor onto the contract: validates the plain id
 * into a branded RouteId (empty ids throw here, never at mount) and
 * preserves title/component/capability/restoreState/focus/cleanup hooks.
 */
export function adaptFactoryDescriptor(descriptor: FactoryDescriptor): PanelDescriptor {
  const { id, ...hooks } = descriptor;
  return { ...hooks, id: routeId(id) };
}

/** Registers one factory's descriptor (post-adaptation) and returns the registry. */
export function registerFactoryRoute(
  registry: RouteRegistry,
  factory: FilesPanelFactory,
  bridge: FileBridge,
): RouteRegistry {
  return registerRoute(registry, adaptFactoryDescriptor(factory({ bridge })));
}

/**
 * Registers the files route (capability-gated on files.v1) through the V2
 * contract and returns the new registry. Single construction path with
 * registerFactoryRoute above; no duplicated factory definitions.
 */
export function registerFilesRoute(
  registry: RouteRegistry,
  component: (props: PanelProps) => ReactNode,
): RouteRegistry {
  return registerRoute(
    registry,
    adaptFactoryDescriptor({
      id: "files.explorer",
      title: "Files",
      component,
      capability: FILES_CAPABILITY,
    }),
  );
}
