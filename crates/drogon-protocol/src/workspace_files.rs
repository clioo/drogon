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
    /// When false, dotfile entries are filtered from the listing. Omitted
    /// (None) preserves the historical behavior of returning every entry.
    pub include_hidden: Option<bool>,
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

    /// Historical listings returned every entry, so an omitted flag keeps
    /// showing hidden entries; only an explicit `false` filters dotfiles.
    pub fn include_hidden_or_default(&self) -> bool {
        self.include_hidden.unwrap_or(true)
    }
}

/// Target kind for `files.create`, mirroring the explorer's New File /
/// New Folder row actions.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileCreateKind {
    File,
    Directory,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCreateParams {
    #[serde(flatten)]
    pub scope: FileScope,
    pub kind: FileCreateKind,
}

/// Two-path scope for `files.rename`: `from` is the existing entry, `to`
/// is the destination. Both are workspace-relative, like `FileScope::path`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRenameParams {
    pub host_id: String,
    pub workspace_id: String,
    pub from: String,
    pub to: String,
}

impl FileRenameParams {
    pub fn validate_target(&self, host_id: &str) -> Result<(), RpcError> {
        validate_opaque_token(&self.host_id, 128, "Invalid file execution host.")?;
        validate_opaque_token(&self.workspace_id, 128, "Invalid file workspace identity.")?;
        if self.host_id != host_id {
            return Err(RpcError::new(
                "unsupported_host",
                "The file execution host is not served by this endpoint.",
            ));
        }
        for path in [&self.from, &self.to] {
            if path.len() > MAX_FILE_PATH_BYTES || path.contains('\0') {
                return Err(RpcError::new(
                    "invalid_argument",
                    "Invalid workspace-relative file path.",
                ));
            }
        }
        Ok(())
    }
}

/// Bounded multi-path scope for `files.delete`. The daemon deletes
/// permanently (no OS-trash dependency); the renderer owns the source's
/// confirmation copy before calling.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDeleteParams {
    pub host_id: String,
    pub workspace_id: String,
    pub paths: Vec<String>,
}

/// Upper bound on one `files.delete` call; larger batches must be split by
/// the caller so a single request cannot hold the mutation ledger open.
pub const MAX_DELETE_PATHS: usize = 128;

impl FileDeleteParams {
    pub fn validate_target(&self, host_id: &str) -> Result<(), RpcError> {
        validate_opaque_token(&self.host_id, 128, "Invalid file execution host.")?;
        validate_opaque_token(&self.workspace_id, 128, "Invalid file workspace identity.")?;
        if self.host_id != host_id {
            return Err(RpcError::new(
                "unsupported_host",
                "The file execution host is not served by this endpoint.",
            ));
        }
        if self.paths.is_empty() || self.paths.len() > MAX_DELETE_PATHS {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid file deletion batch size.",
            ));
        }
        for path in &self.paths {
            if path.len() > MAX_FILE_PATH_BYTES || path.contains('\0') {
                return Err(RpcError::new(
                    "invalid_argument",
                    "Invalid workspace-relative file path.",
                ));
            }
        }
        Ok(())
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

/// Upper bound on one `files.search` call; larger result sets must be
/// narrowed by the caller with a longer query. Quick open ranks
/// client-side, so the daemon only needs a bounded candidate list.
pub const MAX_FILE_SEARCH_RESULTS: usize = 500;

/// Default candidate count when the caller omits `limit`.
pub const DEFAULT_FILE_SEARCH_LIMIT: usize = 100;

/// Byte cap on the search query, mirroring the reference quick-open
/// `QUICK_OPEN_QUERY_MAX_BYTES` (2 KiB).
pub const MAX_FILE_SEARCH_QUERY_BYTES: usize = 2048;

/// Scoped query for `files.search`: workspace-relative path candidates
/// matching `query` (case-insensitive subsequence), bounded by `limit`.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchParams {
    pub host_id: String,
    pub workspace_id: String,
    pub query: String,
    pub limit: Option<usize>,
}

impl FileSearchParams {
    pub fn validate_target(&self, host_id: &str) -> Result<(), RpcError> {
        validate_opaque_token(&self.host_id, 128, "Invalid file execution host.")?;
        validate_opaque_token(&self.workspace_id, 128, "Invalid file workspace identity.")?;
        if self.host_id != host_id {
            return Err(RpcError::new(
                "unsupported_host",
                "The file execution host is not served by this endpoint.",
            ));
        }
        if self.query.contains('\0') || self.query.len() > MAX_FILE_SEARCH_QUERY_BYTES {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid file search query.",
            ));
        }
        Ok(())
    }

    pub fn limit_or_default(&self) -> Result<usize, RpcError> {
        let limit = self.limit.unwrap_or(DEFAULT_FILE_SEARCH_LIMIT);
        if !(1..=MAX_FILE_SEARCH_RESULTS).contains(&limit) {
            return Err(RpcError::new(
                "invalid_argument",
                "Invalid file search result limit.",
            ));
        }
        Ok(limit)
    }

    /// Trimmed query; empty means "first `limit` paths in walk order".
    pub fn normalized_query(&self) -> String {
        self.query.trim().to_string()
    }
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
    fn list_shows_hidden_by_default_and_hides_only_on_explicit_false() {
        let scope = FileScope {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
            path: "".into(),
        };
        // Omitted flag (the historical wire shape) keeps showing everything.
        let legacy: FileListParams =
            serde_json::from_value(json!({"hostId":"host","workspaceId":"workspace","path":""}))
                .unwrap();
        assert!(legacy.include_hidden_or_default());
        assert_eq!(legacy.limit().unwrap(), MAX_DIRECTORY_ENTRIES);
        for (flag, expected) in [(None, true), (Some(true), true), (Some(false), false)] {
            assert_eq!(
                FileListParams {
                    scope: scope.clone(),
                    limit_entries: None,
                    include_hidden: flag
                }
                .include_hidden_or_default(),
                expected
            );
        }
    }

    #[test]
    fn create_kind_round_trips_and_rejects_unknown_kinds() {
        let params: FileCreateParams = serde_json::from_value(
            json!({"hostId":"host","workspaceId":"workspace","path":"a/b","kind":"directory"}),
        )
        .unwrap();
        assert_eq!(params.kind, FileCreateKind::Directory);
        params.scope.validate_target("host").unwrap();
        assert!(
            serde_json::from_value::<FileCreateParams>(
                json!({"hostId":"host","workspaceId":"workspace","path":"a","kind":"symlink"})
            )
            .is_err()
        );
    }

    #[test]
    fn rename_validates_both_paths_and_the_serving_host() {
        let params = FileRenameParams {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
            from: "a.txt".into(),
            to: "b.txt".into(),
        };
        params.validate_target("host").unwrap();
        assert_eq!(
            FileRenameParams {
                host_id: "other".into(),
                ..params.clone()
            }
            .validate_target("host")
            .unwrap_err()
            .code,
            "unsupported_host"
        );
        assert_eq!(
            FileRenameParams {
                to: "x\0y".into(),
                ..params.clone()
            }
            .validate_target("host")
            .unwrap_err()
            .code,
            "invalid_argument"
        );
        assert_eq!(
            FileRenameParams {
                from: "x".repeat(MAX_FILE_PATH_BYTES + 1),
                ..params
            }
            .validate_target("host")
            .unwrap_err()
            .code,
            "invalid_argument"
        );
    }

    #[test]
    fn delete_bounds_batch_size_and_validates_each_path() {
        let valid = FileDeleteParams {
            host_id: "host".into(),
            workspace_id: "workspace".into(),
            paths: vec!["a.txt".into()],
        };
        valid.validate_target("host").unwrap();
        assert_eq!(
            FileDeleteParams {
                paths: vec![],
                ..valid.clone()
            }
            .validate_target("host")
            .unwrap_err()
            .code,
            "invalid_argument"
        );
        assert_eq!(
            FileDeleteParams {
                paths: vec!["a".into(); MAX_DELETE_PATHS + 1],
                ..valid.clone()
            }
            .validate_target("host")
            .unwrap_err()
            .code,
            "invalid_argument"
        );
        assert_eq!(
            FileDeleteParams {
                paths: vec!["x\0y".into()],
                ..valid
            }
            .validate_target("host")
            .unwrap_err()
            .code,
            "invalid_argument"
        );
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
                    limit_entries: Some(limit),
                    include_hidden: None,
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
