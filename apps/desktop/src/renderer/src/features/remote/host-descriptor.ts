/**
 * Host identity for V3 remote routing. `hostId` follows the established
 * grammar `local | ssh:<target-id> | runtime:<environment-id>`; `kind` is
 * the discrete discriminator derived from that registration, never guessed
 * from a label.
 */
export type HostKind = "local" | "ssh" | "wsl" | "relay";

export interface HostDescriptor {
  hostId: string;
  kind: HostKind;
  /** Human-facing display name; never used for routing decisions. */
  label: string;
}
