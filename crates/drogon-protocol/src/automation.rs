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
    /// Harness model override (e.g. a free local model for Pi). Absent
    /// means the harness default. Additive: older callers omit it.
    #[serde(default)]
    pub model: Option<String>,
    /// Harness provider override (Pi only). Absent means the harness
    /// default. Additive: older callers omit it.
    #[serde(default)]
    pub provider: Option<String>,
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
    /// Present string replaces the stored model override; absent/null
    /// leaves it unchanged (there is no explicit-clear spelling).
    #[serde(default)]
    pub model: Option<String>,
    /// Present string replaces the stored provider override; absent/null
    /// leaves it unchanged (there is no explicit-clear spelling).
    #[serde(default)]
    pub provider: Option<String>,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationRunsAllParams {
    /// 1-based page index.
    #[serde(default)]
    pub page: Option<u64>,
    #[serde(default)]
    pub per_page: Option<u64>,
    /// Optional run-status filter (wire snake_case value).
    #[serde(default)]
    pub status: Option<AutomationRunStatus>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AutomationRunParams {
    pub run_id: String,
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
    /// Pinned harness model override, when one was stored at create/update.
    /// Additive: absent means the harness default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Pinned harness provider override (Pi only), when one was stored.
    /// Additive: absent means the harness default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
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

/// One dashboard row: a run plus the owning automation's display name
/// (the runs-all aggregation spans automations, so each row names its own).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunListItem {
    #[serde(flatten)]
    pub run: AutomationRunView,
    /// The run's display title (the dashboard table's second line).
    pub title: String,
    pub automation_name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunsAllResult {
    pub runs: Vec<AutomationRunListItem>,
    pub page: u64,
    pub per_page: u64,
    /// Total matching runs (after the status filter) across automations.
    pub total: u64,
}

/// Output snapshot format; single-valued (`plain_text`) like the source.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRunOutputFormat {
    PlainText,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunOutputSnapshotView {
    pub format: AutomationRunOutputFormat,
    pub content: String,
    pub captured_at: f64,
    pub truncated: bool,
}

/// `automation.run` detail: the history view plus the fields the run page
/// renders (title, workspace display name, the honestly available output
/// snapshot, and whether the run's terminal session still exists).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunDetail {
    #[serde(flatten)]
    pub run: AutomationRunView,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_display_name: Option<String>,
    #[serde(default)]
    pub output_snapshot: Option<AutomationRunOutputSnapshotView>,
    pub session_exists: bool,
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
            model: None,
            provider: None,
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
    fn runs_all_round_trips_flattened_list_items() {
        let result = AutomationRunsAllResult {
            runs: vec![AutomationRunListItem {
                run: AutomationRunView {
                    id: "ar:1".into(),
                    automation_id: "a1".into(),
                    status: AutomationRunStatus::Completed,
                    trigger: AutomationRunTrigger::Manual,
                    scheduled_for: 900.0,
                    workspace_id: Some("w1".into()),
                    terminal_session_id: None,
                    error: None,
                    exit_code: Some(0),
                    started_at: Some(900.0),
                    dispatched_at: Some(900.0),
                    created_at: 900.0,
                },
                title: "nightly run".into(),
                automation_name: "nightly".into(),
            }],
            page: 1,
            per_page: 50,
            total: 1,
        };
        let value = serde_json::to_value(&result).unwrap();
        let item = &value["runs"][0];
        assert_eq!(item["id"], json!("ar:1"));
        assert_eq!(item["title"], json!("nightly run"));
        assert_eq!(item["automationName"], json!("nightly"));
        assert_eq!(item["status"], json!("completed"));
        assert_eq!(value["page"], json!(1));
        assert_eq!(value["total"], json!(1));
        let back: AutomationRunsAllResult = serde_json::from_value(value).unwrap();
        assert_eq!(back, result);
    }

    #[test]
    fn runs_all_params_default_and_reject_unknown_fields() {
        let ok: AutomationRunsAllParams =
            serde_json::from_value(json!({ "page": 2, "perPage": 25 })).unwrap();
        assert_eq!(ok.page, Some(2));
        assert_eq!(ok.per_page, Some(25));
        assert_eq!(ok.status, None);
        // Range checks (page >= 1, perPage <= 200) live in the daemon
        // handler; the wire layer only pins shape.
        let zero: AutomationRunsAllParams = serde_json::from_value(json!({"page": 0})).unwrap();
        assert_eq!(zero.page, Some(0));
        assert!(serde_json::from_value::<AutomationRunsAllParams>(json!({"bogus": 1})).is_err());
        let filtered: AutomationRunsAllParams =
            serde_json::from_value(json!({ "status": "dispatch_failed" })).unwrap();
        assert_eq!(filtered.status, Some(AutomationRunStatus::DispatchFailed));
        assert!(
            serde_json::from_value::<AutomationRunsAllParams>(json!({"status": "bogus"})).is_err()
        );
    }

    #[test]
    fn run_detail_carries_title_snapshot_and_session_flag() {
        let detail = AutomationRunDetail {
            run: AutomationRunView {
                id: "ar:2".into(),
                automation_id: "a1".into(),
                status: AutomationRunStatus::Dispatched,
                trigger: AutomationRunTrigger::Scheduled,
                scheduled_for: 800.0,
                workspace_id: Some("w1".into()),
                terminal_session_id: Some("s1".into()),
                error: None,
                exit_code: None,
                started_at: None,
                dispatched_at: Some(800.0),
                created_at: 800.0,
            },
            title: "nightly run".into(),
            workspace_display_name: Some("alpha".into()),
            output_snapshot: Some(AutomationRunOutputSnapshotView {
                format: AutomationRunOutputFormat::PlainText,
                content: "fixture output".into(),
                captured_at: 810.0,
                truncated: true,
            }),
            session_exists: true,
        };
        let value = serde_json::to_value(&detail).unwrap();
        assert_eq!(value["title"], json!("nightly run"));
        assert_eq!(value["workspaceDisplayName"], json!("alpha"));
        assert_eq!(value["outputSnapshot"]["format"], json!("plain_text"));
        assert_eq!(value["outputSnapshot"]["truncated"], json!(true));
        assert_eq!(value["sessionExists"], json!(true));
        assert_eq!(value["terminalSessionId"], json!("s1"));
        let back: AutomationRunDetail = serde_json::from_value(value).unwrap();
        assert_eq!(back, detail);
    }

    #[test]
    fn create_and_update_params_carry_optional_model_provider() {
        let create: AutomationCreateParams = serde_json::from_value(json!({
            "name": "nightly", "cron": "* * * * *",
            "workspaceId": "w1", "harness": "pi", "prompt": "sweep",
            "model": "qwen3.8-flash-next-nvidia-nvfp4", "provider": "dgx-spark",
        }))
        .unwrap();
        assert_eq!(
            create.model.as_deref(),
            Some("qwen3.8-flash-next-nvidia-nvfp4")
        );
        assert_eq!(create.provider.as_deref(), Some("dgx-spark"));
        let bare: AutomationCreateParams = serde_json::from_value(json!({
            "name": "nightly", "cron": "* * * * *",
            "workspaceId": "w1", "harness": "pi", "prompt": "sweep",
        }))
        .unwrap();
        assert_eq!(bare.model, None);
        assert_eq!(bare.provider, None);
        let update: AutomationUpdateParams = serde_json::from_value(json!({
            "id": "a1", "model": "m", "provider": "dgx-spark",
        }))
        .unwrap();
        assert_eq!(update.model.as_deref(), Some("m"));
        assert_eq!(update.provider.as_deref(), Some("dgx-spark"));
        // Unknown fields are still rejected.
        assert!(
            serde_json::from_value::<AutomationCreateParams>(
                json!({"name": "x", "cron": "* * * * *", "workspaceId": "w1",
                   "harness": "pi", "prompt": "s", "bogus": 1}),
            )
            .is_err()
        );
    }

    #[test]
    fn summary_omits_unset_model_provider_but_round_trips_them() {
        let mut summary = AutomationSummary {
            id: "a1".into(),
            name: "nightly".into(),
            cron: "* * * * *".into(),
            workspace_id: Some("w1".into()),
            harness: "pi".into(),
            model: Some("qwen3.8-flash-next-nvidia-nvfp4".into()),
            provider: Some("dgx-spark".into()),
            prompt: "sweep".into(),
            enabled: true,
            next_run_at: 1000.0,
            last_run_at: None,
            last_run: None,
        };
        let value = serde_json::to_value(&summary).unwrap();
        assert_eq!(value["model"], json!("qwen3.8-flash-next-nvidia-nvfp4"));
        assert_eq!(value["provider"], json!("dgx-spark"));
        let back: AutomationSummary = serde_json::from_value(value).unwrap();
        assert_eq!(back, summary);
        summary.model = None;
        summary.provider = None;
        let bare = serde_json::to_value(&summary).unwrap();
        assert!(bare.get("model").is_none());
        assert!(bare.get("provider").is_none());
        let back: AutomationSummary = serde_json::from_value(bare).unwrap();
        assert_eq!(back, summary);
    }

    #[test]
    fn run_params_use_exact_camel_case_key() {
        let params: AutomationRunParams =
            serde_json::from_value(json!({ "runId": "ar:9" })).unwrap();
        assert_eq!(params.run_id, "ar:9");
        assert!(serde_json::from_value::<AutomationRunParams>(json!({"run_id": "ar:9"})).is_err());
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
