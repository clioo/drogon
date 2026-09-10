//! Wire types for Worktrees: a git worktree (or, for a folder Project, the
//! implicit single worktree that is the folder itself) that a Session
//! attaches to as a Workspace. Mirrors
//! `apps/desktop/src/shared/session-contract.ts`'s `Worktree` type.

use serde::{Deserialize, Deserializer, Serialize};

/// Tri-state wire field: key absent → `None` (leave untouched), explicit
/// null → `Some(None)` (clear), string → `Some(Some(_))` (set). Serde maps
/// a plain `Option<Option<String>>` null to the outer `None`, so the
/// distinction needs this custom deserialize_with + default pair.
fn tri_state_string<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(deserializer)?))
}

/// Same tri-state shape as [`tri_state_string`], for an integer field
/// (`manualOrder`, `linkedPr`): key absent → `None`, explicit `null` →
/// `Some(None)` (clear), a number → `Some(Some(_))` (set).
fn tri_state_i64<'de, D>(deserializer: D) -> Result<Option<Option<i64>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<i64>::deserialize(deserializer)?))
}

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
    /// Free-text note from the composer's Advanced Note row (Orca's
    /// worktree `comment` meta); `None` when never set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Sidebar nesting parent (Orca's composer "Parent worktree" row —
    /// nesting only, never a base-branch change); `None` for a top-level
    /// worktree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_worktree_id: Option<String>,
    pub created_at: String,
    /// User-assigned workspace board status (Workspace Options "Group by:
    /// Workspace status" and the shared board Kanban owns). `None` until a
    /// status is set; the id space is the same
    /// `_workspaceStatuses*`-migrated set the shared UI-prefs file stores
    /// (`workspace-statuses.ts`), never invented per-worktree.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_status: Option<String>,
    /// Workspace Options "Pin" action. Additive: absent on the wire reads
    /// as `false`.
    #[serde(default)]
    pub is_pinned: bool,
    /// Workspace Options "Archive" action -- distinct from `worktree.remove`:
    /// an archived worktree keeps its checkout, it just leaves default nav.
    #[serde(default)]
    pub is_archived: bool,
    /// Monotonic creation-order stamp, assigned once at insert and never
    /// reassigned; the stable tiebreaker for Sort by "Manual" before a
    /// worktree has ever been dragged.
    #[serde(default)]
    pub sort_order: i64,
    /// User-authored sidebar ordering (Sort by "Manual"). Sparse rank,
    /// stride 1000, higher renders first; shared with the Kanban board's
    /// own column-drag ordering (same field, not a parallel one). `None`
    /// until the worktree is ever manually reordered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manual_order: Option<i64>,
    /// RFC3339 timestamp of this worktree's last recorded mutation
    /// (creation, rename, note/status/pin/archive change). Powers Sort by
    /// "Recent" and Hide "Sleeping".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<String>,
    /// Linked pull/merge request number (Group by "PR status"'s data
    /// producer). Number only -- no live open/draft/merged/checks state;
    /// that needs a credentialed provider API integration this change does
    /// not add (see `worktree-card-pr-display.ts`'s own doc for the same
    /// boundary on the display side).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linked_pr: Option<i64>,
    /// Creation provenance (Hide "Automation-created" / "CLI-created").
    /// `None` on rows created before this column existed, or via the
    /// desktop app itself; `Some("cli")` when `drogon-cli worktree create`
    /// set it; `Some("automation")` reserved for automation-dispatched
    /// creation, not yet wired anywhere in this build
    /// (`bot_run_rpc::RunUnsupported::NewPerRunWorkspaceMode`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeCreateParams {
    pub project_id: String,
    pub name: String,
    #[serde(default)]
    pub base_ref: Option<String>,
    /// Explicit git branch name (the composer's Advanced "Branch name"
    /// row); absent, the branch is derived from `name`.
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub parent_worktree_id: Option<String>,
    /// Sparse-checkout directories (cone mode); absent/empty checks the
    /// worktree out in full.
    #[serde(default)]
    pub sparse: Option<Vec<String>>,
    /// Creation provenance: `"cli"` when `drogon-cli worktree create` set
    /// it, absent for the desktop app's own create path (recorded as
    /// `None`, read as "desktop/legacy" by the Hide filters).
    #[serde(default)]
    pub creator: Option<String>,
}

/// Worktree-meta update (`worktree.update`): tri-state fields — absent
/// leaves the column untouched, explicit null clears it. Mirrors the
/// fork's `applyWorktreeMeta` for the note and the parent picker's
/// nesting edge.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeUpdateParams {
    pub worktree_id: String,
    #[serde(default, deserialize_with = "tri_state_string")]
    pub note: Option<Option<String>>,
    #[serde(default, deserialize_with = "tri_state_string")]
    pub parent_worktree_id: Option<Option<String>>,
    /// Workspace Options "Group by: Workspace status" / the shared board's
    /// status column. Tri-state like `note`: absent leaves it untouched,
    /// explicit null clears it back to "no status".
    #[serde(default, deserialize_with = "tri_state_string")]
    pub workspace_status: Option<Option<String>>,
    /// Workspace Options "Pin"/"Unpin" action. Not tri-state -- a bool has
    /// no meaningful "clear", so absent leaves it untouched and present
    /// always sets an explicit value.
    #[serde(default)]
    pub is_pinned: Option<bool>,
    /// Workspace Options "Archive"/"Unarchive" action.
    #[serde(default)]
    pub is_archived: Option<bool>,
    /// Sort by "Manual" drag order; the client computes the sparse rank
    /// (stride 1000) and persists it here. Tri-state: explicit null drops
    /// the worktree back to unranked (falls after every ranked sibling).
    #[serde(default, deserialize_with = "tri_state_i64")]
    pub manual_order: Option<Option<i64>>,
    /// Linked pull/merge request number. Tri-state like `note`.
    #[serde(default, deserialize_with = "tri_state_i64")]
    pub linked_pr: Option<Option<i64>>,
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
            note: None,
            parent_worktree_id: None,
            created_at: "2026-09-05T12:00:00Z".into(),
            workspace_status: None,
            is_pinned: false,
            is_archived: false,
            sort_order: 0,
            manual_order: None,
            last_activity_at: None,
            linked_pr: None,
            creator: None,
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
                "isPinned": false, "isArchived": false, "sortOrder": 0,
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
        assert_eq!(params.branch, None);
        assert_eq!(params.note, None);
        assert_eq!(params.parent_worktree_id, None);
        assert_eq!(params.sparse, None);
    }

    #[test]
    fn create_params_decode_the_composer_advanced_fields() {
        let params: WorktreeCreateParams = serde_json::from_value(json!({
            "projectId": "p1",
            "name": "feature",
            "baseRef": "main",
            "branch": "feature/my-branch",
            "note": "Investigate flake",
            "parentWorktreeId": "w0",
            "sparse": ["src", "docs"]
        }))
        .unwrap();
        assert_eq!(params.branch.as_deref(), Some("feature/my-branch"));
        assert_eq!(params.note.as_deref(), Some("Investigate flake"));
        assert_eq!(params.parent_worktree_id.as_deref(), Some("w0"));
        assert_eq!(
            params.sparse,
            Some(vec!["src".to_string(), "docs".to_string()])
        );
    }

    #[test]
    fn note_and_parent_are_additive_and_default_to_none() {
        let value = serde_json::to_value(sample()).unwrap();
        assert!(value.get("note").is_none());
        assert!(value.get("parentWorktreeId").is_none());
        let mut noted = sample();
        noted.note = Some("remember this".into());
        noted.parent_worktree_id = Some("w0".into());
        let value = serde_json::to_value(&noted).unwrap();
        assert_eq!(value["note"], "remember this");
        assert_eq!(value["parentWorktreeId"], "w0");
        let back: Worktree = serde_json::from_value(value).unwrap();
        assert_eq!(back.note.as_deref(), Some("remember this"));
        assert_eq!(back.parent_worktree_id.as_deref(), Some("w0"));
    }

    #[test]
    fn update_params_distinguish_absent_from_explicit_null() {
        let params: WorktreeUpdateParams =
            serde_json::from_value(json!({"worktreeId": "w1"})).unwrap();
        assert_eq!(params.note, None);
        assert_eq!(params.parent_worktree_id, None);
        let cleared: WorktreeUpdateParams = serde_json::from_value(
            json!({"worktreeId": "w1", "note": null, "parentWorktreeId": "w0"}),
        )
        .unwrap();
        assert_eq!(cleared.note, Some(None));
        assert_eq!(cleared.parent_worktree_id, Some(Some("w0".into())));
    }

    /// Workspace Options metadata (Group by/Sort by/Pin/Archive/PR-link
    /// producers): additive on the wire and defaults exactly the way
    /// `note`/`title`/`parentWorktreeId` already do, plus the same
    /// absent/null/value tri-state distinction on `worktree.update` for
    /// the nullable ones.
    #[test]
    fn workspace_options_metadata_is_additive_and_defaults_to_absent() {
        let value = serde_json::to_value(sample()).unwrap();
        assert!(value.get("workspaceStatus").is_none());
        assert!(value.get("manualOrder").is_none());
        assert!(value.get("lastActivityAt").is_none());
        assert!(value.get("linkedPr").is_none());
        assert!(value.get("creator").is_none());
        assert_eq!(value["isPinned"], json!(false));
        assert_eq!(value["isArchived"], json!(false));
        assert_eq!(value["sortOrder"], json!(0));

        let mut populated = sample();
        populated.workspace_status = Some("in-progress".into());
        populated.is_pinned = true;
        populated.is_archived = true;
        populated.sort_order = 7;
        populated.manual_order = Some(3000);
        populated.last_activity_at = Some("2026-09-09T00:00:00Z".into());
        populated.linked_pr = Some(42);
        populated.creator = Some("cli".into());
        let value = serde_json::to_value(&populated).unwrap();
        assert_eq!(value["workspaceStatus"], "in-progress");
        assert_eq!(value["isPinned"], json!(true));
        assert_eq!(value["isArchived"], json!(true));
        assert_eq!(value["sortOrder"], json!(7));
        assert_eq!(value["manualOrder"], json!(3000));
        assert_eq!(value["lastActivityAt"], "2026-09-09T00:00:00Z");
        assert_eq!(value["linkedPr"], json!(42));
        assert_eq!(value["creator"], "cli");
        let back: Worktree = serde_json::from_value(value).unwrap();
        assert_eq!(back, populated);
    }

    #[test]
    fn update_params_workspace_options_fields_distinguish_absent_from_explicit_null() {
        let untouched: WorktreeUpdateParams =
            serde_json::from_value(json!({"worktreeId": "w1"})).unwrap();
        assert_eq!(untouched.workspace_status, None);
        assert_eq!(untouched.is_pinned, None);
        assert_eq!(untouched.is_archived, None);
        assert_eq!(untouched.manual_order, None);
        assert_eq!(untouched.linked_pr, None);

        let set: WorktreeUpdateParams = serde_json::from_value(json!({
            "worktreeId": "w1",
            "workspaceStatus": "in-review",
            "isPinned": true,
            "isArchived": false,
            "manualOrder": 2000,
            "linkedPr": 42,
        }))
        .unwrap();
        assert_eq!(set.workspace_status, Some(Some("in-review".into())));
        assert_eq!(set.is_pinned, Some(true));
        assert_eq!(set.is_archived, Some(false));
        assert_eq!(set.manual_order, Some(Some(2000)));
        assert_eq!(set.linked_pr, Some(Some(42)));

        let cleared: WorktreeUpdateParams = serde_json::from_value(json!({
            "worktreeId": "w1",
            "workspaceStatus": null,
            "manualOrder": null,
            "linkedPr": null,
        }))
        .unwrap();
        assert_eq!(cleared.workspace_status, Some(None));
        assert_eq!(cleared.manual_order, Some(None));
        assert_eq!(cleared.linked_pr, Some(None));
    }

    #[test]
    fn create_params_accept_the_creator_provenance_field() {
        let params: WorktreeCreateParams = serde_json::from_value(json!({
            "projectId": "p1", "name": "feature", "creator": "cli"
        }))
        .unwrap();
        assert_eq!(params.creator.as_deref(), Some("cli"));
        let params: WorktreeCreateParams =
            serde_json::from_value(json!({"projectId": "p1", "name": "feature"})).unwrap();
        assert_eq!(params.creator, None);
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
