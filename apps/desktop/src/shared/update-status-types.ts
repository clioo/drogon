// Source provenance: Lovecast Inc. MIT source c97906287bb7a390b25e2025b600d9fb3c25d9c3,
// src/shared/update-status-types.ts (SHA256 44b969908a37001615d7cab88cba7cf619032c67c971f3c020c3abddf1b54809).
// Its release-channel type-only dependency is reproduced structurally here so this
// bounded Electron seam does not import the unported release/update implementation.

export type ReleaseChannel = "stable" | "rc" | "hourly" | "daily" | "adhoc";
export type DedicatedRepoChannel = "hourly" | "daily" | "adhoc";

export type ReleaseBuild = {
  tag: string;
  version: string;
  channel: ReleaseChannel;
  name: string | null;
  publishedAt: string | null;
  releaseUrl: string;
  installerUrl: string | null;
};

export type ChangelogRelease = {
  title: string;
  description: string;
  mediaUrl?: string;
  releaseNotesUrl: string;
};

export type ChangelogData = {
  release: ChangelogRelease;
  releasesBehind: number | null;
};

export type UpdateCheckOptions = {
  includePrerelease?: boolean;
  includePerfPrerelease?: boolean;
  localBuild?: boolean;
  /** Dev channel switching; targetTag pins an exact build, including older ones. */
  channel?: ReleaseChannel;
  targetTag?: string;
};

export type UpdateSource = "local" | DedicatedRepoChannel;
export type LinuxRootPackageType = "deb" | "rpm";

export type LinuxPackageInstallFailureReason =
  | "authentication-agent-unavailable"
  | "authentication-denied"
  | "package-install-failed";

export type LinuxPackageInstallRecoveryReason =
  | "manual-install-required"
  | LinuxPackageInstallFailureReason;

export type LinuxPackageInstallRecovery = {
  kind: "linux-package-install";
  packageType: LinuxRootPackageType;
  reason: LinuxPackageInstallRecoveryReason;
  version: string;
};

export type LinuxPackageCommandUnavailableReason =
  | "no-sudo"
  | "no-package-manager";

export type LinuxPackageInstallInstructions =
  | { ok: true; command: string; packageFileName: string }
  | {
      ok: false;
      reason: LinuxPackageCommandUnavailableReason;
      message: string;
    };

export type UpdateStatus = (
  | { state: "idle" }
  | { state: "checking"; userInitiated?: boolean }
  | {
      state: "available";
      version: string;
      activeNudgeId?: string;
      releaseUrl?: string;
      changelog: ChangelogData | null;
      externallyManaged?: boolean;
    }
  | { state: "not-available"; userInitiated?: boolean }
  | {
      state: "downloading";
      percent: number;
      version: string;
      activeNudgeId?: string;
    }
  | {
      state: "downloaded";
      version: string;
      releaseUrl?: string;
      activeNudgeId?: string;
    }
  | {
      state: "error";
      message: string;
      version?: string;
      retryable?: boolean;
      userInitiated?: boolean;
      activeNudgeId?: string;
      recovery?: LinuxPackageInstallRecovery;
    }
) & { source?: UpdateSource };

export type ReleaseBuildListResult =
  | { ok: true; channel: ReleaseChannel; builds: ReleaseBuild[] }
  | { ok: false; channel: ReleaseChannel; message: string };
