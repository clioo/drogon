//! The Subagent policy's failover order, as pure decision logic: given a
//! policy and the runtimes already attempted, which runtime tries next.
//!
//! No I/O here — `graph_rpc.rs` owns compiling, launching and recording
//! attempts; this module only decides the SEQUENCE, so the sequencing rule
//! itself has one place to read and one place to test.
//!
//! What counts as failure, decided and defended here (spec asks for this):
//! a launch that never starts (a compile-time refusal — bad provider
//! binding, unsupported harness, or the runtime's own `check`/`doctor`
//! rejecting the recipe) is unconditionally a failure — nothing ran, so
//! there is nothing honest to wait for. A run that STARTED and later
//! settled `failed` also counts as an execution failure. A tester reporting
//! findings is a completed execution with a separate evaluation verdict;
//! it must not exhaust runtimes simply because it found a product bug. A run
//! that settles `unverifiable` (lost contact) or `blocked` (never got a
//! chance to run) does NOT advance failover: the daemon cannot honestly
//! blame the runtime for an outcome it never actually observed, so calling
//! code refuses instead of silently guessing and moving on.

use drogon_protocol::graph::{GraphPolicy, GraphRuntimeRef};

/// The free, local runtime this build may always run for real without a
/// human asking per call (AGENTS.md's model policy). Used as the sole
/// approved runtime whenever the Subagent policy has none configured yet,
/// so a brand-new workspace's subagents cost nothing by default and the
/// no-paid-inference rule holds even before anyone opens the policy panel.
pub fn default_free_runtime() -> GraphRuntimeRef {
    GraphRuntimeRef {
        harness: "pi".to_string(),
        model: "qwen3.8-flash-next-nvidia-nvfp4".to_string(),
    }
}

/// The full ordered attempt sequence: every approved runtime in order (or
/// the zero-cost default when none are configured), then the fallback last
/// when one is set. `approvedRuntimes` order IS the failover order — this
/// is the one place that ordering is turned into an actual sequence.
pub fn attempt_sequence(policy: &GraphPolicy) -> Vec<GraphRuntimeRef> {
    let mut sequence: Vec<GraphRuntimeRef> = if policy.approved_runtimes.is_empty() {
        vec![default_free_runtime()]
    } else {
        policy.approved_runtimes.clone()
    };
    if let Some(fallback) = &policy.fallback_runtime {
        sequence.push(fallback.clone());
    }
    sequence
}

/// Given the runtimes already tried (in attempt order) for a node's current
/// failover episode, the next one to try — or `None` once the whole
/// sequence (every approved runtime, then the fallback) is exhausted.
/// Position-based, not set-based: a policy that happens to repeat the same
/// pair twice is tried twice, honoring the list exactly as configured.
pub fn next_runtime(
    policy: &GraphPolicy,
    attempted: &[GraphRuntimeRef],
) -> Option<GraphRuntimeRef> {
    attempt_sequence(policy).into_iter().nth(attempted.len())
}

/// The zero-based attempt position identifies the fallback, even when its
/// harness/model pair also occurs in the approved list.
pub fn is_fallback_attempt(policy: &GraphPolicy, attempt_index: usize) -> bool {
    policy.fallback_runtime.is_some() && attempt_index == policy.approved_runtimes.len().max(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime(harness: &str, model: &str) -> GraphRuntimeRef {
        GraphRuntimeRef {
            harness: harness.into(),
            model: model.into(),
        }
    }

    #[test]
    fn an_empty_policy_tries_only_the_free_default() {
        let policy = GraphPolicy::default();
        assert_eq!(attempt_sequence(&policy), vec![default_free_runtime()]);
        assert_eq!(next_runtime(&policy, &[]), Some(default_free_runtime()));
        assert_eq!(next_runtime(&policy, &[default_free_runtime()]), None);
    }

    #[test]
    fn an_empty_policy_with_only_a_fallback_still_tries_the_default_first() {
        let policy = GraphPolicy {
            fallback_runtime: Some(runtime("custom", "qwen3-coder")),
            ..GraphPolicy::default()
        };
        assert_eq!(
            attempt_sequence(&policy),
            vec![default_free_runtime(), runtime("custom", "qwen3-coder")]
        );
    }

    #[test]
    fn approved_runtimes_are_tried_in_configured_order_then_the_fallback() {
        let policy = GraphPolicy {
            approved_runtimes: vec![
                runtime("opencode", "claude-sonnet-4"),
                runtime("opencode", "gpt-5.3-codex"),
                runtime("codex", "gpt-5.3-codex"),
            ],
            fallback_runtime: Some(runtime("custom", "qwen3-coder")),
            ..GraphPolicy::default()
        };
        let sequence = attempt_sequence(&policy);
        assert_eq!(
            sequence,
            vec![
                runtime("opencode", "claude-sonnet-4"),
                runtime("opencode", "gpt-5.3-codex"),
                runtime("codex", "gpt-5.3-codex"),
                runtime("custom", "qwen3-coder"),
            ]
        );
        assert_eq!(next_runtime(&policy, &[]), Some(sequence[0].clone()));
        assert_eq!(
            next_runtime(&policy, &sequence[..1]),
            Some(sequence[1].clone())
        );
        assert_eq!(
            next_runtime(&policy, &sequence[..3]),
            Some(sequence[3].clone()),
            "the fallback is the last resort, only once every approved runtime failed"
        );
        assert_eq!(
            next_runtime(&policy, &sequence),
            None,
            "once the fallback itself has been tried, the sequence is exhausted"
        );
    }

    #[test]
    fn no_fallback_configured_means_exhaustion_after_the_approved_list() {
        let policy = GraphPolicy {
            approved_runtimes: vec![runtime("opencode", "claude-sonnet-4")],
            fallback_runtime: None,
            ..GraphPolicy::default()
        };
        assert_eq!(
            next_runtime(&policy, &[runtime("opencode", "claude-sonnet-4")]),
            None
        );
    }

    #[test]
    fn fallback_identity_uses_position_even_when_the_pair_is_approved() {
        let policy = GraphPolicy {
            approved_runtimes: vec![runtime("opencode", "claude-sonnet-4")],
            fallback_runtime: Some(runtime("opencode", "claude-sonnet-4")),
            ..GraphPolicy::default()
        };
        assert!(!is_fallback_attempt(&policy, 0));
        assert!(is_fallback_attempt(&policy, 1));
        assert!(!is_fallback_attempt(&policy, 2));
        let no_fallback = GraphPolicy::default();
        assert!(!is_fallback_attempt(&no_fallback, 0));
    }
}
