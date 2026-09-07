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
}
