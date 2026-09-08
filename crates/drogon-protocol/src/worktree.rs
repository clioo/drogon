//! Wire types for Worktrees: a git worktree (or, for a folder Project, the
//! implicit single worktree that is the folder itself) that a Session
//! attaches to as a Workspace. Mirrors
//! `apps/desktop/src/shared/session-contract.ts`'s `Worktree` type.

use serde::{Deserialize, Serialize};

pub const WORKTREE_CAPABILITY: &str = "worktree.v1";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub project_id: String,
    pub workspace_id: String,
    pub path: String,
    pub branch: String,
    pub head: String,
    pub base_ref: Option<String>,
    /// Display title set by `worktree.rename`; `None` when never renamed.
    /// Never a branch rename and never a directory move — mirrors Orca's
    /// `updateWorktreeMeta(displayName)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateParams {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub base_ref: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListParams {
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRemoveParams {
    pub id: String,
    #[serde(default)]
    pub force: bool,
}

/// Display-title rename: `{ worktreeId, name }`. Renames exactly what
/// Orca's inline rename renames — the card's display title — never the
/// git branch and never the worktree directory.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRenameParams {
    pub worktree_id: String,
    pub name: String,
}

impl WorktreeRenameParams {
    pub fn validate_name(&self) -> Result<(), crate::RpcError> {
        let trimmed = self.name.trim();
        if trimmed.is_empty() || self.name.len() > 256 || self.name.contains('\0') {
            return Err(crate::RpcError::new(
                "invalid_argument",
                "Invalid worktree name.",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeListResult {
    pub worktrees: Vec<Worktree>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn sample() -> Worktree {
        Worktree {
            id: "w1".into(),
            project_id: "p1".into(),
            workspace_id: "ws1".into(),
            path: "/data/workspaces/repo/feature".into(),
            branch: "feature".into(),
            head: "abc123".into(),
            base_ref: Some("main".into()),
            title: None,
            created_at: "2026-09-05T12:00:00Z".into(),
        }
    }

    #[test]
    fn worktree_round_trips_with_exact_wire_keys() {
        let worktree = sample();
        let value = serde_json::to_value(&worktree).unwrap();
        assert_eq!(
            value,
            json!({
                "id": "w1", "projectId": "p1", "workspaceId": "ws1",
                "path": "/data/workspaces/repo/feature", "branch": "feature",
                "head": "abc123", "baseRef": "main",
                "createdAt": "2026-09-05T12:00:00Z",
            })
        );
        let back: Worktree = serde_json::from_value(value).unwrap();
        assert_eq!(back, worktree);
    }

    #[test]
    fn base_ref_is_nullable_for_an_implicit_folder_worktree() {
        let mut worktree = sample();
        worktree.base_ref = None;
        let value = serde_json::to_value(&worktree).unwrap();
        assert_eq!(value["baseRef"], Value::Null);
    }

    #[test]
    fn create_params_default_base_ref_to_none_and_accept_additive_fields() {
        let params: WorktreeCreateParams = serde_json::from_value(json!({
            "projectId": "p1", "name": "feature", "future": true
        }))
        .unwrap();
        assert_eq!(params.project_id, "p1");
        assert_eq!(params.name, "feature");
        assert_eq!(params.base_ref, None);
    }

    #[test]
    fn remove_params_default_force_to_false() {
        let params: WorktreeRemoveParams = serde_json::from_value(json!({"id": "w1"})).unwrap();
        assert!(!params.force);
        let forced: WorktreeRemoveParams =
            serde_json::from_value(json!({"id": "w1", "force": true})).unwrap();
        assert!(forced.force);
    }

    #[test]
    fn title_is_additive_and_defaults_to_none() {
        let value = serde_json::to_value(sample()).unwrap();
        assert!(value.get("title").is_none());
        let mut titled = sample();
        titled.title = Some("My feature".into());
        let value = serde_json::to_value(&titled).unwrap();
        assert_eq!(value["title"], "My feature");
        let back: Worktree = serde_json::from_value(value).unwrap();
        assert_eq!(back.title.as_deref(), Some("My feature"));
    }

    #[test]
    fn rename_params_use_worktree_id_and_name_wire_keys() {
        let params: WorktreeRenameParams =
            serde_json::from_value(json!({"worktreeId": "w1", "name": "New title"})).unwrap();
        assert_eq!(params.worktree_id, "w1");
        params.validate_name().unwrap();
        for bad in ["", "   ", &"x".repeat(257), "has\0nul"] {
            let params = WorktreeRenameParams {
                worktree_id: "w1".into(),
                name: bad.into(),
            };
            assert!(params.validate_name().is_err(), "must reject {bad:?}");
        }
    }

    #[test]
    fn list_result_wraps_worktrees_under_the_plural_key() {
        let result = WorktreeListResult {
            worktrees: vec![sample()],
        };
        let value = serde_json::to_value(&result).unwrap();
        assert!(value["worktrees"].is_array());
        assert_eq!(value["worktrees"][0]["branch"], "feature");
    }
}
