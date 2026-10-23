//! Additive Work source connection parameters. Keys never enter the mutation ledger.
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConnectParams {
    pub provider: String,
    pub api_key: Option<String>,
    pub api_url: Option<String>,
    /// Plane's workspace URL slug; absent for other sources.
    pub workspace_slug: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn workspace_slug_is_additive_and_optional_for_existing_sources() {
        let linear: SourceConnectParams =
            serde_json::from_value(json!({"provider":"linear", "apiKey":"fixture"})).unwrap();
        assert!(linear.workspace_slug.is_none());
        let plane: SourceConnectParams = serde_json::from_value(
            json!({"provider":"plane", "apiKey":"fixture", "workspaceSlug":"my-team"}),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_value(plane).unwrap()["workspaceSlug"],
            "my-team"
        );
    }
}
