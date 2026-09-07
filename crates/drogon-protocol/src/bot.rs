//! Wire types for a Bot chat turn's history: mirrors
//! `crates/drogon-core/src/bots/records.rs`'s `BotMessage`/`HostObservation`
//! and `apps/desktop/src/shared/bot-contract.ts`'s `BotsPanelHostObservation`.
//! Consumed by `drogon-core`'s `bot.history` RPC to serialize its result.

use serde::{Deserialize, Serialize};

/// `live` / `unverifiable` / `exited`: evidence only, never a synthesized
/// completion verdict. Mirrors `bots::records::HostObservation` exactly.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BotHostObservation {
    Live,
    Exited,
    Unverifiable,
}

/// One chat turn, as returned by `bot.history`. `sessionId`/`incarnation`
/// let a caller read the actual reply bytes via the existing `session.read`
/// path; this type never carries the reply text itself.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotMessageWire {
    pub id: String,
    pub bot_id: String,
    pub request_id: String,
    pub prompt: String,
    pub session_id: Option<String>,
    pub incarnation: Option<String>,
    pub host_observation: Option<BotHostObservation>,
    pub error: Option<String>,
    pub started_at: f64,
    pub ended_at: Option<f64>,
}

/// `bot.history` result: newest-first, bounded by the request's `limit`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotHistoryResult {
    pub host_id: String,
    pub workspace_id: String,
    pub bot_id: String,
    pub messages: Vec<BotMessageWire>,
}

/// Params for `bot.responsibility_create`: creates one scheduled
/// (cron) responsibility on a Bot together with the Bot-owned automation
/// the daemon scheduler fires. `schedule` is a 5-field cron in UTC, the
/// same expression shape `automation.create` admits; `prompt` becomes both
/// the automation prompt and the responsibility instructions. The
/// automation runs in `workspace_id` under the Bot's own harness policy.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BotResponsibilityCreateParams {
    pub workspace_id: String,
    pub host_id: String,
    pub bot_id: String,
    pub name: String,
    pub schedule: String,
    pub prompt: String,
}

/// Params for `bot.responsibility_delete`: removes the responsibility from
/// the Bot and deletes its still-Bot-owned scheduled automation (runs
/// included). Responsibility-run history rows are preserved as orphaned
/// evidence, never deleted.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BotResponsibilityDeleteParams {
    pub workspace_id: String,
    pub host_id: String,
    pub bot_id: String,
    pub responsibility_id: String,
}

/// Lean `bot.responsibility_create` result: ids only. Callers re-read the
/// full Bot through `bot.snapshot`, the same refresh pattern the desktop
/// panel already uses after `bot.create`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotResponsibilityCreateResult {
    pub host_id: String,
    pub workspace_id: String,
    pub bot_id: String,
    pub responsibility_id: String,
    pub automation_id: String,
}

/// `bot.responsibility_delete` result. `automation_id` is the deleted
/// automation, or `None` when there was nothing Bot-owned left to delete
/// (reactive responsibility, or an already-gone automation).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotResponsibilityDeleteResult {
    pub host_id: String,
    pub workspace_id: String,
    pub bot_id: String,
    pub responsibility_id: String,
    pub removed: bool,
    pub automation_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> BotMessageWire {
        BotMessageWire {
            id: "msg-1".into(),
            bot_id: "bot-1".into(),
            request_id: "req-1".into(),
            prompt: "What is the status?".into(),
            session_id: Some("session-1".into()),
            incarnation: Some("inc-1".into()),
            host_observation: Some(BotHostObservation::Live),
            error: None,
            started_at: 1000.0,
            ended_at: Some(1001.0),
        }
    }

    #[test]
    fn message_round_trips_with_exact_wire_keys() {
        let message = sample();
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(
            value,
            json!({
                "id": "msg-1", "botId": "bot-1", "requestId": "req-1",
                "prompt": "What is the status?", "sessionId": "session-1",
                "incarnation": "inc-1", "hostObservation": "live",
                "error": null, "startedAt": 1000.0, "endedAt": 1001.0,
            })
        );
        let back: BotMessageWire = serde_json::from_value(value).unwrap();
        assert_eq!(back, message);
    }

    #[test]
    fn dispatch_failure_carries_no_session_or_observation() {
        let mut message = sample();
        message.session_id = None;
        message.incarnation = None;
        message.host_observation = None;
        message.ended_at = None;
        message.error = Some("harness.start failed".into());
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(value["sessionId"], serde_json::Value::Null);
        assert_eq!(value["hostObservation"], serde_json::Value::Null);
        assert_eq!(value["error"], "harness.start failed");
    }

    #[test]
    fn history_result_wraps_messages_newest_first_as_supplied() {
        let result = BotHistoryResult {
            host_id: "host-1".into(),
            workspace_id: "ws-1".into(),
            bot_id: "bot-1".into(),
            messages: vec![sample()],
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["hostId"], "host-1");
        assert_eq!(value["workspaceId"], "ws-1");
        assert_eq!(value["botId"], "bot-1");
        assert_eq!(value["messages"][0]["id"], "msg-1");
    }

    #[test]
    fn host_observation_accepts_all_three_states() {
        for (variant, wire) in [
            (BotHostObservation::Live, "live"),
            (BotHostObservation::Exited, "exited"),
            (BotHostObservation::Unverifiable, "unverifiable"),
        ] {
            assert_eq!(serde_json::to_value(variant).unwrap(), json!(wire));
        }
    }

    #[test]
    fn responsibility_create_params_use_exact_wire_keys_and_deny_unknown() {
        let value = json!({
            "workspaceId": "ws-1", "hostId": "host-1", "botId": "bot-1",
            "name": "Nightly review", "schedule": "* * * * *",
            "prompt": "Review incoming work.",
        });
        let params: BotResponsibilityCreateParams = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(params.schedule, "* * * * *");
        let missing = json!({
            "workspaceId": "ws-1", "hostId": "host-1", "botId": "bot-1",
            "name": "Nightly review", "schedule": "* * * * *",
        });
        assert!(serde_json::from_value::<BotResponsibilityCreateParams>(missing).is_err());
        let extra = json!({"workspaceId": "ws-1", "hostId": "host-1", "botId": "bot-1",
            "name": "n", "schedule": "* * * * *", "prompt": "p", "locale": "en-US"});
        assert!(serde_json::from_value::<BotResponsibilityCreateParams>(extra).is_err());
    }

    #[test]
    fn responsibility_delete_params_use_exact_wire_keys_and_deny_unknown() {
        let value = json!({
            "workspaceId": "ws-1", "hostId": "host-1", "botId": "bot-1",
            "responsibilityId": "resp-1",
        });
        let params: BotResponsibilityDeleteParams = serde_json::from_value(value).unwrap();
        assert_eq!(params.responsibility_id, "resp-1");
        let extra = json!({"workspaceId": "ws-1", "hostId": "host-1", "botId": "bot-1",
            "responsibilityId": "resp-1", "force": true});
        assert!(serde_json::from_value::<BotResponsibilityDeleteParams>(extra).is_err());
    }

    #[test]
    fn responsibility_results_round_trip_with_exact_wire_keys() {
        let created = BotResponsibilityCreateResult {
            host_id: "host-1".into(),
            workspace_id: "ws-1".into(),
            bot_id: "bot-1".into(),
            responsibility_id: "resp-1".into(),
            automation_id: "auto-1".into(),
        };
        assert_eq!(
            serde_json::to_value(&created).unwrap(),
            json!({
                "hostId": "host-1", "workspaceId": "ws-1", "botId": "bot-1",
                "responsibilityId": "resp-1", "automationId": "auto-1",
            })
        );
        let back: BotResponsibilityCreateResult =
            serde_json::from_value(serde_json::to_value(&created).unwrap()).unwrap();
        assert_eq!(back, created);

        let deleted = BotResponsibilityDeleteResult {
            host_id: "host-1".into(),
            workspace_id: "ws-1".into(),
            bot_id: "bot-1".into(),
            responsibility_id: "resp-1".into(),
            removed: true,
            automation_id: None,
        };
        let value = serde_json::to_value(&deleted).unwrap();
        assert_eq!(value["automationId"], serde_json::Value::Null);
        assert_eq!(value["removed"], json!(true));
        let back: BotResponsibilityDeleteResult = serde_json::from_value(value).unwrap();
        assert_eq!(back, deleted);
    }
}
