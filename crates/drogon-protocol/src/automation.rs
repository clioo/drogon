//! Wire types for standalone automations (journey J7): cron-scheduled,
//! bot-free runs that the daemon fires through the existing runner seam.
//! Mirrors the daemon's admitted `automation.*` params and the list/history
//! projections (which carry `nextRunAt` and a last-run summary).

use serde::{Deserialize, Serialize};

pub const AUTOMATION_CAPABILITY: &str = "automation.v1";

/// Run statuses the history and last-run projections can carry. Mirrors
/// `drogon-core`'s `AutomationRunStatus` wire form (snake_case).
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunStatus {
    Pending,
    Dispatching,
    Dispatched,
    Completed,
    SkippedPrecheck,
    SkippedMissed,
    SkippedUnavailable,
    SkippedNeedsInteractiveAuth,
    DispatchFailed,
}

/// Trigger wire form, mirroring `drogon-core`'s `AutomationRunTrigger`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AutomationRunTrigger {
    Scheduled,
    Manual,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationCreateParams {
    pub name: String,
    pub cron: String,
    pub workspace_id: String,
    pub harness: String,
    pub prompt: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub grace_minutes: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationUpdateParams {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub cron: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub harness: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub grace_minutes: Option<f64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationDeleteParams {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationRunNowParams {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationHistoryParams {
    pub automation_id: String,
    #[serde(default)]
    pub limit: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LastRunSummary {
    pub id: String,
    pub status: AutomationRunStatus,
    pub trigger: AutomationRunTrigger,
    pub scheduled_for: f64,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSummary {
    pub id: String,
    pub name: String,
    pub cron: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub harness: String,
    pub prompt: String,
    pub enabled: bool,
    pub next_run_at: f64,
    #[serde(default)]
    pub last_run_at: Option<f64>,
    #[serde(default)]
    pub last_run: Option<LastRunSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationListResult {
    pub automations: Vec<AutomationSummary>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunView {
    pub id: String,
    pub automation_id: String,
    pub status: AutomationRunStatus,
    pub trigger: AutomationRunTrigger,
    pub scheduled_for: f64,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub terminal_session_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i64>,
    #[serde(default)]
    pub started_at: Option<f64>,
    #[serde(default)]
    pub dispatched_at: Option<f64>,
    pub created_at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationHistoryResult {
    pub runs: Vec<AutomationRunView>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunNowOutcome {
    Dispatched,
    Refused,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunNowResult {
    pub automation_id: String,
    #[serde(default)]
    pub run_id: Option<String>,
    pub outcome: AutomationRunNowOutcome,
    #[serde(default)]
    pub status: Option<AutomationRunStatus>,
    #[serde(default)]
    pub refusal: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn create_params_use_exact_camel_case_keys() {
        let params: AutomationCreateParams = serde_json::from_value(json!({
            "name": "nightly", "cron": "* * * * *",
            "workspaceId": "w1", "harness": "pi", "prompt": "sweep",
        }))
        .unwrap();
        assert_eq!(params.name, "nightly");
        assert_eq!(params.workspace_id, "w1");
        assert_eq!(params.enabled, None);
        let missing = serde_json::from_value::<AutomationCreateParams>(
            json!({"name": "x", "cron": "* * * * *", "workspaceId": "w1", "harness": "pi"}),
        );
        assert!(missing.is_err());
    }

    #[test]
    fn summary_round_trips_with_exact_wire_keys() {
        let summary = AutomationSummary {
            id: "a1".into(),
            name: "nightly".into(),
            cron: "* * * * *".into(),
            workspace_id: Some("w1".into()),
            harness: "pi".into(),
            prompt: "sweep".into(),
            enabled: true,
            next_run_at: 1000.0,
            last_run_at: None,
            last_run: Some(LastRunSummary {
                id: "ar:x".into(),
                status: AutomationRunStatus::Completed,
                trigger: AutomationRunTrigger::Scheduled,
                scheduled_for: 900.0,
                error: None,
                exit_code: Some(0),
            }),
        };
        let value = serde_json::to_value(&summary).unwrap();
        assert_eq!(
            value,
            json!({
                "id": "a1", "name": "nightly", "cron": "* * * * *",
                "workspaceId": "w1", "harness": "pi", "prompt": "sweep",
                "enabled": true, "nextRunAt": 1000.0, "lastRunAt": null,
                "lastRun": {
                    "id": "ar:x", "status": "completed", "trigger": "scheduled",
                    "scheduledFor": 900.0, "error": null, "exitCode": 0,
                },
            })
        );
        let back: AutomationSummary = serde_json::from_value(value).unwrap();
        assert_eq!(back, summary);
    }

    #[test]
    fn status_and_trigger_reject_unknown_values() {
        assert!(serde_json::from_value::<AutomationRunStatus>(json!("bogus")).is_err());
        assert!(serde_json::from_value::<AutomationRunTrigger>(json!("SCHEDULED")).is_err());
        let ok: AutomationRunStatus = serde_json::from_value(json!("skipped_missed")).unwrap();
        assert_eq!(ok, AutomationRunStatus::SkippedMissed);
    }

    #[test]
    fn history_wraps_runs_and_list_wraps_automations() {
        let history = AutomationHistoryResult { runs: vec![] };
        assert!(serde_json::to_value(&history).unwrap()["runs"].is_array());
        let list = AutomationListResult {
            automations: vec![],
        };
        assert!(serde_json::to_value(&list).unwrap()["automations"].is_array());
    }

    #[test]
    fn run_now_result_reports_refusal_without_status() {
        let result = AutomationRunNowResult {
            automation_id: "a1".into(),
            run_id: Some("ar:y".into()),
            outcome: AutomationRunNowOutcome::Refused,
            status: None,
            refusal: Some("disabled".into()),
            error: None,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["outcome"], "refused");
        assert_eq!(value["refusal"], "disabled");
    }
}
