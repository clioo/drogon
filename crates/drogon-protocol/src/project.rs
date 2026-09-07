//! Wire types for Projects: a git repository or a plain folder that owns
//! Worktrees (`docs/migration/rewrite-mvp-plan.md` journey J1). Mirrors
//! `apps/desktop/src/shared/session-contract.ts`'s `Project` type.

use serde::{Deserialize, Serialize};

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
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAddParams {
    pub path: String,
    #[serde(default)]
    pub name: Option<String>,
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
    fn list_result_wraps_projects_under_the_plural_key() {
        let result = ProjectListResult {
            projects: vec![Project {
                id: "p1".into(),
                host_id: "h1".into(),
                path: "/repo".into(),
                name: "repo".into(),
                kind: ProjectKind::Git,
                default_base_ref: None,
            }],
        };
        let value = serde_json::to_value(&result).unwrap();
        assert!(value["projects"].is_array());
        assert_eq!(value["projects"][0]["id"], "p1");
    }
}
