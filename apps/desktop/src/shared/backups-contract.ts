// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P6 contract: the desktop's `backups` namespace mirrors
// `drogon-cli backups list/restore` (crates/drogon-cli/src/backups.rs), which
// is the single source of truth for manifest validation and restorability
// classification. The bridge parses the CLI's own JSON through these shapes
// before anything reaches the renderer.

export type BackupPendingMigration = {
  component: string;
  recordedVersion: number;
  migratingTo: number;
};

export type BackupEntryInfo = {
  /** Directory name under `<dataDir>/backups`, e.g. `pre-migration-<unix-ms>`. */
  id: string;
  createdAt: string | null;
  originalDataDir: string | null;
  writerBuildVersion: string | null;
  sizeBytes: number | null;
  pendingMigrations: BackupPendingMigration[];
  restorable: boolean;
  /** Manifest does not match the contents; never restorable. */
  invalidReason: string | null;
  /** Valid backup, but NEWER than this build: restoring would re-trigger
   * the downgrade refusal this overlay is showing. */
  notRestorableReason: string | null;
};

export type BackupsListResult = {
  dataDir: string;
  backups: BackupEntryInfo[];
  preRestoreSnapshots: BackupEntryInfo[];
};

export type BackupsRestoreResult = {
  restoredBackupId: string;
  preRestoreSnapshotId: string | null;
  databaseFile: string;
  sizeBytes: number;
};

/** Additive `window.drogon.backups` namespace (preload/backups.ts). */
export type BackupsBridgeResult =
  | { ok: true; list: BackupsListResult }
  | { ok: true; restore: BackupsRestoreResult }
  | { ok: true; relaunchApp: true }
  | { ok: false; error: string };

export type BackupsBridge = {
  list(): Promise<BackupsBridgeResult>;
  restore(backupId: string): Promise<BackupsBridgeResult>;
  /** Full app relaunch, offered ONLY after a successful restore: the fresh
   * bootstrap starts the daemon against the restored data dir without the
   * refusal in play. Resolves right before main relaunches. */
  relaunchApp(): Promise<BackupsBridgeResult>;
};
