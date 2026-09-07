use drogon_protocol::orchestration_mail::CheckResult;
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
