//! MIT Copyright (c) 2026 Lovecast Inc.
//! Behavioral port of orchestration/task-deps-flag.ts, with native generated IDs too.
use crate::error::CliError;

pub(crate) fn parse(raw: &str) -> Result<Vec<String>, CliError> {
    if let Ok(ids) = serde_json::from_str::<Vec<String>>(raw) {
        return Ok(ids);
    }
    // PowerShell 5.1 can remove JSON quotes at the native argv boundary.
    if let Some(body) = raw
        .trim()
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
    {
        let ids: Vec<_> = body.split(',').map(str::trim).collect();
        if ids.iter().all(|id| generated_task_id(id)) {
            return Ok(ids.into_iter().map(str::to_string).collect());
        }
    }
    Err(CliError::Usage(
        "Invalid --deps: must be a JSON array of task IDs".into(),
    ))
}
fn generated_task_id(id: &str) -> bool {
    let Some(suffix) = id.strip_prefix("task_") else {
        return false;
    };
    (suffix.len() == 12 && suffix.bytes().all(|b| b.is_ascii_hexdigit()))
        || uuid::Uuid::parse_str(suffix)
            .is_ok_and(|id| id.hyphenated().to_string().eq_ignore_ascii_case(suffix))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_arrays_preserve_ids_and_order() {
        assert_eq!(parse("[]").unwrap(), Vec::<String>::new());
        assert_eq!(
            parse("[\"arbitrary-id\",\"task_123456abcdef\"]").unwrap(),
            ["arbitrary-id", "task_123456abcdef"]
        );
    }
    #[test]
    fn quote_stripping_recovers_only_generated_ids() {
        assert_eq!(
            parse(" [ task_123456abcdef , task_abcdef123456 ] ").unwrap(),
            ["task_123456abcdef", "task_abcdef123456"]
        );
        let native = "task_22e7b10b-2db9-40c4-ae16-3d1e4503cb6a";
        assert_eq!(parse(&format!("[{native}]")).unwrap(), [native]);
    }
    #[test]
    fn malformed_or_mixed_dependencies_are_not_guessed() {
        for raw in [
            "task_123456abcdef",
            "[anything]",
            "[task_123]",
            "[task_123456abcdef,]",
            "[123]",
            "null",
            "{}",
            "[\"ok\",3]",
            "[task_123456abcdef,bad]",
        ] {
            assert!(parse(raw).is_err(), "{raw}");
        }
    }
}
