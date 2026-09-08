// V2-owned mount adapter for the V3 files panel (handoff "Rutas y paneles").
// Binds the REAL stabilized V3 factory (features/workspaces/files-panel,
// assembled from cbe54ad) through the V2 route-panel-contract boundary.
// The single App mount stays V2-owned; V3 never touches App.tsx.

import type { ReactNode } from "react";
import { FILES_CAPABILITY } from "../../shared/file-contract";
import type { FileBridge } from "../../shared/file-contract";
import {
  createFilesPanelDescriptor,
  FILES_ROUTE_ID as V3_FILES_ROUTE_ID,
  isFilesAvailable,
} from "./features/workspaces/files-panel";
import type { FileOpenRequestCell } from "./features/workspaces/files-panel";
import {
  registerRoute,
  routeId,
} from "./route-panel-contract";
import type { PanelDescriptor, PanelProps, RouteRegistry } from "./route-panel-contract";

/** Branded form of the V3 route id; empty V3 ids throw at import. */
export const FILES_ROUTE_ID = routeId(V3_FILES_ROUTE_ID);

export { isFilesAvailable };

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
 * Fail-closed capability gate around a FileBridge. Every call evaluates
 * isAllowed at call time: when the live service is known to withhold
 * files.v1 the call is refused locally (never reaching the service) with
 * an explicit retryable error, so a kept-alive panel cannot issue calls
 * behind a withheld capability while its drafts stay mounted. Transient
 * unknown states keep the last App-level decision via the callback.
 */
export function createGatedFileBridge(
  source: FileBridge,
  isAllowed: () => boolean,
): FileBridge {
  const refused = () =>
    Promise.resolve({
      ok: false as const,
      error: {
        code: "unsupported_capability",
        message: "files.v1 capability is not advertised by the service",
        retryable: true,
      },
    });
  return {
    fileList: (input) => (isAllowed() ? source.fileList(input) : refused()),
    fileRead: (input) => (isAllowed() ? source.fileRead(input) : refused()),
    fileWrite: (input) => (isAllowed() ? source.fileWrite(input) : refused()),
    // Explorer mutations are optional on the source until the daemon wires
    // dispatch and the preload exposes the channels: absent methods stay
    // absent (the explorer disables the UI), never synthesized here.
    ...(source.fileCreate
      ? {
          fileCreate: (input: Parameters<NonNullable<FileBridge["fileCreate"]>>[0]) =>
            isAllowed() ? source.fileCreate!(input) : refused(),
        }
      : {}),
    ...(source.fileRename
      ? {
          fileRename: (input: Parameters<NonNullable<FileBridge["fileRename"]>>[0]) =>
            isAllowed() ? source.fileRename!(input) : refused(),
        }
      : {}),
    ...(source.fileDelete
      ? {
          fileDelete: (input: Parameters<NonNullable<FileBridge["fileDelete"]>>[0]) =>
            isAllowed() ? source.fileDelete!(input) : refused(),
        }
      : {}),
    // Bounded quick-open search (R12-B `files.search`): same optional
    // forwarding — absent on older hosts, in which case quick open falls
    // back to the `files.list` walk instead of crashing.
    ...(source.fileSearch
      ? {
          fileSearch: (input: Parameters<NonNullable<FileBridge["fileSearch"]>>[0]) =>
            isAllowed() ? source.fileSearch!(input) : refused(),
        }
      : {}),
  };
}

/**
 * Registers the REAL V3 files route (capability-gated on files.v1) through
 * the V2 contract and returns the new registry. Single construction path
 * with registerFactoryRoute above; no duplicated factory definitions.
 */
export function registerFilesRoute(
  registry: RouteRegistry,
  bridge: FileBridge,
  openRequestCell?: FileOpenRequestCell,
): RouteRegistry {
  const factory: FilesPanelFactory = (input) =>
    createFilesPanelDescriptor({ ...input, openRequestCell });
  return registerFactoryRoute(registry, factory, bridge);
}
