use drogon_protocol::orchestration_mail::{CheckParams, CheckResult};
use drogon_protocol::orchestration_question::AskParams;
use serde_json::json;

#[test]
fn resume_cannot_change_recipient_at_decode() {
    let params = json!({
        "scope": {"actorKind":"dispatch", "contractVersion":1, "hostId":"h", "runId":"r", "taskId":"t", "dispatchId":"d"},
        "intent":"resume", "questionMessageId":"q",
        "to":{"kind":"dispatch", "dispatchId":"another"},
        "wait":{"timeoutMs":1}
    });
    assert!(serde_json::from_value::<AskParams>(params).is_err());
}

#[test]
fn delivered_message_ids_must_match_the_exact_fifo_batch() {
    let result: CheckResult = serde_json::from_value(json!({
        "delivery":{"deliveryId":"batch", "messageIds":["m1"]},
        "messages":[{"messageId":"m2", "sequence":1, "kind":"status", "fromActor":"a", "subject":"s"}]
    })).unwrap();
    assert!(result.validate_shape().is_err());
}

fn paged_check(mode: &str) -> serde_json::Value {
    json!({
        "scope":{"actorKind":"dispatch","contractVersion":1,"hostId":"h","runId":"r","taskId":"t","dispatchId":"d"},
        "mode":mode,"cursor":"opaque-cursor","limit":25
    })
}

#[test]
fn inspection_check_can_round_trip_its_returned_cursor() {
    for mode in ["peek", "all"] {
        let params: CheckParams = serde_json::from_value(paged_check(mode)).unwrap();
        params.validate_shape("h").unwrap();
        let encoded = serde_json::to_value(params).unwrap();
        assert_eq!(encoded["cursor"], "opaque-cursor");
        assert_eq!(encoded["limit"], 25);
    }
}

#[test]
fn consuming_check_refuses_pagination_that_could_split_a_delivery() {
    let params: CheckParams = serde_json::from_value(paged_check("unread")).unwrap();
    assert_eq!(
        params.validate_shape("h").unwrap_err().code,
        "invalid_argument"
    );
}
