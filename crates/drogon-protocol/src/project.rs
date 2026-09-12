//! Wire types for Projects: a git repository or a plain folder that owns
//! Worktrees (journey J1). Mirrors
//! `apps/desktop/src/shared/session-contract.ts`'s `Project` type.

use serde::{Deserialize, Deserializer, Serialize};

/// Tri-state wire field (`project.update`): key absent → `None` (leave
/// untouched), explicit null → `Some(None)` (clear), string → set. Serde
/// maps a plain `Option<Option<String>>` null to the outer `None`, so the
/// distinction needs this custom deserialize_with + default pair.
fn tri_state_string<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Some(Option::<String>::deserialize(deserializer)?))
}

pub const PROJECT_CAPABILITY: &str = "project.v1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Git,
    Folder,
}

impl ProjectKind {
    pub fn as_wire(self) -> &'static str {
        match self {
            ProjectKind::Git => "git",
            ProjectKind::Folder => "folder",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub host_id: String,
    pub path: String,
    pub name: String,
    pub kind: ProjectKind,
    pub default_base_ref: Option<String>,
    /// Setup script from Project Settings, run in a "Setup" terminal after
    /// worktree creation when the composer's Run-setup toggle is on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_script: Option<String>,
    /// True for a Quick Session scratch project (app-owned folder under the
    /// data dir, deleted when the project is removed).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub quick_session: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAddParams {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
}

/// Project-settings update (`project.update`): tri-state — absent leaves
/// the column untouched, explicit null clears it.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUpdateParams {
    pub id: String,
    #[serde(default, deserialize_with = "tri_state_string")]
    pub setup_script: Option<Option<String>>,
}

/// Quick Session (`project.quickSessionCreate`): an app-owned scratch
/// folder registered as a folder Project with its implicit Workspace.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickSessionCreateParams {
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickSessionCreateResult {
    pub project: Project,
    pub workspace_id: String,
}

/// A named sparse-checkout preset (the composer Advanced "Sparse checkout"
/// row), stored per project.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SparsePreset {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub directories: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparsePresetListParams {
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SparsePresetListResult {
    pub presets: Vec<SparsePreset>,
}

/// Upsert (`project.saveSparsePreset`): `id` edits an existing preset,
/// absent creates one.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SparsePresetSaveParams {
    pub project_id: String,
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub directories: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRemoveParams {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListResult {
    pub projects: Vec<Project>,
}

/// Revision digest over the project registry (`project.changes`, additive
/// for #146): an opaque string that moves on every project/worktree
/// mutation and rests otherwise, so a second client can poll one cheap
/// digest instead of the full `project.list` fan-out to learn the registry
/// moved out from under it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChangesResult {
    pub revision: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn project_round_trips_with_exact_wire_keys_and_null_base_ref() {
        let project = Project {
            id: "p1".into(),
            host_id: "h1".into(),
            path: "/repo".into(),
            name: "repo".into(),
            kind: ProjectKind::Git,
            default_base_ref: None,
            setup_script: None,
            quick_session: false,
        };
        let value = serde_json::to_value(&project).unwrap();
        assert_eq!(
            value,
            json!({
                "id": "p1", "hostId": "h1", "path": "/repo", "name": "repo",
                "kind": "git", "defaultBaseRef": null,
            })
        );
        let back: Project = serde_json::from_value(value).unwrap();
        assert_eq!(back, project);
    }

    #[test]
    fn folder_kind_serializes_lowercase_and_accepts_additive_fields_and_base_ref() {
        let value = json!({
            "id": "p2", "hostId": "h1", "path": "/f", "name": "f",
            "kind": "folder", "defaultBaseRef": "main", "future": true
        });
        let project: Project = serde_json::from_value(value).unwrap();
        assert_eq!(project.kind, ProjectKind::Folder);
        assert_eq!(project.kind.as_wire(), "folder");
        assert_eq!(project.default_base_ref.as_deref(), Some("main"));
    }

    #[test]
    fn unknown_kind_is_rejected_not_silently_widened() {
        let value = json!({
            "id": "p3", "hostId": "h1", "path": "/f", "name": "f",
            "kind": "svn", "defaultBaseRef": null
        });
        assert!(serde_json::from_value::<Project>(value).is_err());
    }

    #[test]
    fn add_params_require_a_path_but_name_is_optional() {
        let err = serde_json::from_value::<ProjectAddParams>(json!({"name": "x"})).unwrap_err();
        assert!(err.to_string().contains("path"));

        let params: ProjectAddParams = serde_json::from_value(json!({"path": "/repo"})).unwrap();
        assert_eq!(params.path, "/repo");
        assert_eq!(params.name, None);
    }

    #[test]
    fn changes_result_carries_an_opaque_revision_string() {
        let result = ProjectChangesResult {
            revision: "abc123".into(),
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value, json!({ "revision": "abc123" }));
        let back: ProjectChangesResult = serde_json::from_value(value).unwrap();
        assert_eq!(back.revision, "abc123");
    }

    #[test]
    fn list_result_wraps_projects_under_the_plural_key() {
        let result = ProjectListResult {
            projects: vec![Project {
                id: "p1".into(),
                host_id: "h1".into(),
                path: "/repo".into(),
                name: "repo".into(),
                kind: ProjectKind::Git,
                default_base_ref: None,
                setup_script: None,
                quick_session: false,
            }],
        };
        let value = serde_json::to_value(&result).unwrap();
        assert!(value["projects"].is_array());
        assert_eq!(value["projects"][0]["id"], "p1");
    }

    #[test]
    fn setup_script_and_quick_session_are_additive() {
        let project = Project {
            id: "p1".into(),
            host_id: "h1".into(),
            path: "/repo".into(),
            name: "repo".into(),
            kind: ProjectKind::Git,
            default_base_ref: None,
            setup_script: None,
            quick_session: false,
        };
        let value = serde_json::to_value(&project).unwrap();
        assert!(value.get("setupScript").is_none());
        assert!(value.get("quickSession").is_none());
        let mut configured = project.clone();
        configured.setup_script = Some("pnpm install".into());
        configured.quick_session = true;
        let value = serde_json::to_value(&configured).unwrap();
        assert_eq!(value["setupScript"], "pnpm install");
        assert_eq!(value["quickSession"], true);
        let back: Project = serde_json::from_value(value).unwrap();
        assert_eq!(back, configured);
        // Older daemons omit both keys; deserializing still works.
        let legacy = serde_json::to_value(&project).unwrap();
        let back: Project = serde_json::from_value(legacy).unwrap();
        assert_eq!(back.setup_script, None);
        assert!(!back.quick_session);
    }

    #[test]
    fn update_params_distinguish_absent_from_explicit_null() {
        let params: ProjectUpdateParams = serde_json::from_value(json!({"id": "p1"})).unwrap();
        assert_eq!(params.setup_script, None);
        let cleared: ProjectUpdateParams =
            serde_json::from_value(json!({"id": "p1", "setupScript": null})).unwrap();
        assert_eq!(cleared.setup_script, Some(None));
        let set: ProjectUpdateParams =
            serde_json::from_value(json!({"id": "p1", "setupScript": "make setup"})).unwrap();
        assert_eq!(set.setup_script, Some(Some("make setup".into())));
    }

    #[test]
    fn quick_session_result_wraps_project_and_workspace_id() {
        let result = QuickSessionCreateResult {
            project: Project {
                id: "p9".into(),
                host_id: "h1".into(),
                path: "/data/quick-sessions/session-1".into(),
                name: "Quick Session".into(),
                kind: ProjectKind::Folder,
                default_base_ref: None,
                setup_script: None,
                quick_session: true,
            },
            workspace_id: "ws9".into(),
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["project"]["name"], "Quick Session");
        assert_eq!(value["project"]["quickSession"], true);
        assert_eq!(value["workspaceId"], "ws9");
        let back: QuickSessionCreateResult = serde_json::from_value(value).unwrap();
        assert_eq!(back, result);
    }

    #[test]
    fn sparse_preset_wire_shapes() {
        let preset = SparsePreset {
            id: "sp1".into(),
            project_id: "p1".into(),
            name: "App only".into(),
            directories: vec!["apps/desktop".into()],
        };
        let value = serde_json::to_value(&preset).unwrap();
        assert_eq!(
            value,
            json!({
                "id": "sp1", "projectId": "p1", "name": "App only",
                "directories": ["apps/desktop"],
            })
        );
        let save: SparsePresetSaveParams = serde_json::from_value(json!({
            "projectId": "p1", "name": "App only", "directories": ["apps/desktop"]
        }))
        .unwrap();
        assert_eq!(save.id, None);
    }
}
