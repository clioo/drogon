import type { Result } from "./session-contract";

export const FILES_CAPABILITY = "files.v1";
export const MAX_FILE_BYTES = 65_536;
export const MAX_DIRECTORY_ENTRIES = 1_000;

export type FileScope = {
  hostId: string;
  workspaceId: string;
  path: string;
};
export type WorkspaceFileEntry = {
  name: string;
  kind: "file" | "directory" | "symlink";
  size: number;
  mtime: string;
};
export type FileListResult = FileScope & {
  entries: WorkspaceFileEntry[];
  truncated: boolean;
};
export type FileReadResult = FileScope & {
  content: string;
  size: number;
  mtime: string;
};
export type FileWriteResult = FileScope & { size: number; mtime: string };
/** Target kind for `files.create`, mirroring the explorer's New File / New Folder actions. */
export type FileCreateKind = "file" | "directory";
export type FileCreateResult = FileScope & { kind: FileCreateKind };
export type FileRenameResult = {
  hostId: string;
  workspaceId: string;
  from: string;
  to: string;
};
export type FileDeleteResult = {
  hostId: string;
  workspaceId: string;
  deleted: string[];
};
/** Upper bound on one `files.delete` call; larger batches must be split by the caller. */
export const MAX_DELETE_PATHS = 128;
export interface FileBridge {
  fileList(
    input: FileScope & { limitEntries?: number; includeHidden?: boolean },
  ): Promise<Result<FileListResult>>;
  fileRead(
    input: FileScope & { maxBytes?: number },
  ): Promise<Result<FileReadResult>>;
  fileWrite(
    input: FileScope & { content: string; requestId: string },
  ): Promise<Result<FileWriteResult>>;
  /**
   * Explorer mutations. OPTIONAL until the daemon wires `files.create` /
   * `files.rename` / `files.delete` dispatch and the preload exposes the
   * channels: the explorer treats an absent method as unavailable (disabled
   * UI with an explanatory title), never as a crash. Present in fakes and
   * tests so the wire mapping is covered before the daemon lands.
   */
  fileCreate?(
    input: FileScope & { kind: FileCreateKind },
  ): Promise<Result<FileCreateResult>>;
  fileRename?(
    input: { hostId: string; workspaceId: string; from: string; to: string },
  ): Promise<Result<FileRenameResult>>;
  fileDelete?(
    input: { hostId: string; workspaceId: string; paths: string[] },
  ): Promise<Result<FileDeleteResult>>;
}
