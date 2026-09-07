//! Additive file RPC shapes; the execution host must still verify workspace ownership.

use crate::RpcError;
use crate::orchestration_common::validate_opaque_token;
use serde::{Deserialize, Serialize};

pub const FILES_CAPABILITY: &str = "files.v1";
pub const MAX_FILE_BYTES: u64 = 65_536;
pub const MAX_DIRECTORY_ENTRIES: usize = 1_000;
pub const MAX_FILE_PATH_BYTES: usize = 32_768;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileScope {
    pub host_id: String,
    pub workspace_id: String,
    pub path: String,
}

impl FileScope {
    pub fn validate_target(&self, host_id: &str) -> Result<(), RpcError> {
        validate_opaque_token(&self.host_id, 128, "Invalid file execution host.")?;
        validate_opaque_token(&self.workspace_id, 128, "Invalid file workspace identity.")?;
        if self.host_id != host_id {
            return Err(RpcError::new(
                "unsupported_host",
                "The file execution host is not served by this endpoint.",
            ));
        }
        if self.path.len() > MAX_FILE_PATH_BYTES || self.path.contains('\0') {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid workspace-relative file path.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileListParams {
    #[serde(flatten)]
    pub scope: FileScope,
    pub limit_entries: Option<usize>,
}

impl FileListParams {
    pub fn limit(&self) -> Result<usize, RpcError> {
        let limit = self.limit_entries.unwrap_or(MAX_DIRECTORY_ENTRIES);
        if !(1..=MAX_DIRECTORY_ENTRIES).contains(&limit) {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid directory entry limit.",
            ));
        }
        Ok(limit)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadParams {
    #[serde(flatten)]
    pub scope: FileScope,
    pub max_bytes: Option<u64>,
}

impl FileReadParams {
    pub fn limit(&self) -> Result<u64, RpcError> {
        let limit = self.max_bytes.unwrap_or(MAX_FILE_BYTES);
        if !(1..=MAX_FILE_BYTES).contains(&limit) {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid file byte limit.",
            ));
        }
        Ok(limit)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteParams {
    #[serde(flatten)]
    pub scope: FileScope,
    pub content_base64: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scope_requires_host_and_preserves_additive_fields() {
        let mut input =
            json!({"hostId":"host", "workspaceId":"workspace", "path":"", "future":true});
        let list: FileListParams = serde_json::from_value(input.clone()).unwrap();
        list.scope.validate_target("host").unwrap();
        assert_eq!(list.limit().unwrap(), MAX_DIRECTORY_ENTRIES);
        input.as_object_mut().unwrap().remove("hostId");
        assert!(serde_json::from_value::<FileListParams>(input).is_err());
    }

    #[test]
    fn scope_refuses_other_host_and_unbounded_path() {
        let mut scope = FileScope {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
            path: "file".into(),
        };
        assert_eq!(
            scope.validate_target("other").unwrap_err().code,
            "unsupported_host"
        );
        for path in ["x\0y".to_string(), "x".repeat(MAX_FILE_PATH_BYTES + 1)] {
            scope.path = path;
            assert_eq!(
                scope.validate_target("host").unwrap_err().code,
                "invalid_argument"
            );
        }
    }

    #[test]
    fn directory_and_file_limits_are_bounded() {
        let scope = FileScope {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
            path: "file".into(),
        };
        for limit in [0, MAX_DIRECTORY_ENTRIES + 1] {
            assert!(
                FileListParams {
                    scope: scope.clone(),
                    limit_entries: Some(limit)
                }
                .limit()
                .is_err()
            );
        }
        for limit in [0, MAX_FILE_BYTES + 1] {
            assert!(
                FileReadParams {
                    scope: scope.clone(),
                    max_bytes: Some(limit)
                }
                .limit()
                .is_err()
            );
        }
        assert_eq!(
            FileReadParams {
                scope,
                max_bytes: None
            }
            .limit()
            .unwrap(),
            MAX_FILE_BYTES
        );
    }
}
