import {
  fileBridgeSchemas,
  fileResultSchemas,
} from "../shared/file-validation";
import { MAX_DIRECTORY_ENTRIES, MAX_FILE_BYTES } from "../shared/file-contract";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";

type FileMethod = keyof typeof fileBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

export async function dispatchFileRequest(
  method: FileMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = fileBridgeSchemas[method].safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "invalid_argument",
        message: "Invalid file request.",
        retryable: false,
      },
    };
  const value = parsed.data;
  const { hostId, workspaceId, path } = value;
  const scope = { hostId, workspaceId, path };
  let nativeMethod: keyof typeof fileResultSchemas;
  let params: object;
  let requestId: string | undefined;
  if (method === "fileWrite") {
    const write = fileBridgeSchemas.fileWrite.parse(value);
    nativeMethod = "files.write";
    requestId = write.requestId;
    params = {
      ...scope,
      contentBase64: Buffer.from(write.content, "utf8").toString("base64"),
    };
  } else if (method === "fileRead") {
    nativeMethod = "files.read";
    params = fileBridgeSchemas.fileRead.parse(value);
  } else {
    nativeMethod = "files.list";
    params = fileBridgeSchemas.fileList.parse(value);
  }
  const result = await call(nativeMethod, params, requestId);
  if (!result.ok) return result;
  const checked = fileResultSchemas[nativeMethod].safeParse(result.result);
  const invalid = (): Result<never> => ({
    ok: false,
    error: {
      code: "internal_error",
      message:
        "The file response does not match the requested identity or byte count.",
      retryable: false,
    },
  });
  if (!checked.success) return invalid();
  const output = checked.data;
  if (
    output.hostId !== hostId ||
    output.workspaceId !== workspaceId ||
    output.path !== path
  )
    return invalid();
  if (method === "fileRead") {
    const read = fileResultSchemas["files.read"].parse(output);
    if (
      Buffer.byteLength(read.content, "utf8") !== read.size ||
      read.size >
        (fileBridgeSchemas.fileRead.parse(value).maxBytes ?? MAX_FILE_BYTES)
    )
      return invalid();
  }
  if (
    method === "fileList" &&
    "entries" in output &&
    output.entries.length >
      (fileBridgeSchemas.fileList.parse(value).limitEntries ??
        MAX_DIRECTORY_ENTRIES)
  )
    return invalid();
  if (
    method === "fileWrite" &&
    "size" in output &&
    output.size !==
      Buffer.byteLength(
        fileBridgeSchemas.fileWrite.parse(value).content,
        "utf8",
      )
  )
    return invalid();
  return { ok: true, result: output };
}
