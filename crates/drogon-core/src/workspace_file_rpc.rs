use std::path::PathBuf;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use drogon_protocol::workspace_files::{
    FileListParams, FileReadParams, FileScope, FileWriteParams, MAX_FILE_BYTES,
};
use drogon_protocol::{MAX_FRAME_BYTES, RpcError};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::{Engine, error, workspace, workspace_files};

impl Engine {
    fn file_workspace_root(&self, scope: &FileScope) -> Result<PathBuf, RpcError> {
        scope.validate_target(&self.host_id)?;
        let path = workspace::owned_path(
            &self.db.lock().unwrap(),
            &self.host_id,
            &scope.workspace_id,
            &scope.host_id,
        )?;
        Ok(PathBuf::from(path))
    }

    pub(super) fn do_files_list(&self, value: &Value) -> Result<Value, RpcError> {
        let params: FileListParams = decode(value)?;
        let root = self.file_workspace_root(&params.scope)?;
        let listing = workspace_files::list_dir(&root, &params.scope.path, params.limit()?)?;
        let mut result = scope_result(&params.scope);
        let mut entries = Vec::new();
        let mut truncated = listing.truncated;
        // Leave room for the scope, response envelope and escaped request ID.
        let mut remaining = MAX_FRAME_BYTES / 2;
        for entry in listing.entries {
            let kind = match entry.kind {
                workspace_files::EntryKind::File => "file",
                workspace_files::EntryKind::Dir => "directory",
                workspace_files::EntryKind::Symlink => "symlink",
            };
            let value =
                json!({"name":entry.name, "kind":kind, "size":entry.size, "mtime":entry.mtime});
            let bytes = serde_json::to_vec(&value)
                .map_err(|_| error::internal_error("Could not serialize directory entry"))?
                .len()
                + 1;
            if bytes > remaining {
                truncated = true;
                break;
            }
            remaining -= bytes;
            entries.push(value);
        }
        result["entries"] = Value::Array(entries);
        result["truncated"] = json!(truncated);
        Ok(result)
    }

    pub(super) fn do_files_read(&self, value: &Value) -> Result<Value, RpcError> {
        let params: FileReadParams = decode(value)?;
        let root = self.file_workspace_root(&params.scope)?;
        let file = workspace_files::read_file(&root, &params.scope.path, params.limit()?)?;
        let mut result = scope_result(&params.scope);
        result["content"] = json!(file.content);
        result["size"] = json!(file.size);
        result["mtime"] = json!(file.mtime);
        Ok(result)
    }

    pub(super) fn do_files_write(&self, value: &Value) -> Result<Value, RpcError> {
        let params: FileWriteParams = decode(value)?;
        let root = self.file_workspace_root(&params.scope)?;
        if params.content_base64.len() > (MAX_FILE_BYTES as usize).div_ceil(3) * 4 {
            return Err(error::invalid_argument(
                "File content exceeds the byte limit",
            ));
        }
        let bytes = STANDARD
            .decode(&params.content_base64)
            .map_err(|_| error::invalid_argument("Invalid base64 file content"))?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err(error::invalid_argument(
                "File content exceeds the byte limit",
            ));
        }
        std::str::from_utf8(&bytes)
            .map_err(|_| error::invalid_argument("File content must be valid UTF-8"))?;
        let file = workspace_files::write_file(&root, &params.scope.path, &bytes)?;
        let mut result = scope_result(&params.scope);
        result["size"] = json!(file.size);
        result["mtime"] = json!(file.mtime);
        Ok(result)
    }
}

fn decode<T: DeserializeOwned>(value: &Value) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|_| error::invalid_argument("Invalid file request parameters"))
}

fn scope_result(scope: &FileScope) -> Value {
    json!({"hostId":scope.host_id, "workspaceId":scope.workspace_id, "path":scope.path})
}
