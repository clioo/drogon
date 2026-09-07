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
export interface FileBridge {
  fileList(
    input: FileScope & { limitEntries?: number },
  ): Promise<Result<FileListResult>>;
  fileRead(
    input: FileScope & { maxBytes?: number },
  ): Promise<Result<FileReadResult>>;
  fileWrite(
    input: FileScope & { content: string; requestId: string },
  ): Promise<Result<FileWriteResult>>;
}
