//! Responsibility policy: notification by default, inference only explicit.
//!
//! A monitor change produces a local notification/event. It never starts a
//! model call, a session, or a conversation on its own. Inference happens
//! only when the monitor is explicitly bound to an enabled responsibility
//! policy that the existing Bot runner admits — and even then the runner
//! (C08) owns admission. Unchanged polls always produce zero model
//! requests and no empty conversations.

use serde::{Deserialize, Serialize};

/// What a committed monitor event may trigger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MonitorInferencePolicy {
    /// Default: write the local event intent and stop. No model calls.
    #[default]
    NotificationOnly,
    /// Explicit opt-in: the existing Bot runner may run this enabled
    /// responsibility for the event. The responsibility id is only a
    /// reference; this module never launches it.
    ExplicitResponsibility { responsibility_id: String },
}

impl MonitorInferencePolicy {
    /// True only for an explicitly bound responsibility. The runner still
    /// applies its own enabled/ownership/host gates afterward.
    pub fn inference_allowed(&self) -> bool {
        matches!(self, Self::ExplicitResponsibility { .. })
    }

    /// Model requests attributable to one unchanged poll: always zero.
    pub fn model_calls_for_unchanged_poll() -> u32 {
        0
    }

    /// Model requests attributable to the monitor layer for one changed
    /// event: always zero here. NotificationOnly stops at the local event;
    /// ExplicitResponsibility defers to the runner, which accounts its own
    /// calls (this function does not pre-authorize any).
    pub fn model_calls_for_changed_event(&self) -> u32 {
        0
    }

    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::NotificationOnly => Ok(()),
            Self::ExplicitResponsibility { responsibility_id } => {
                if responsibility_id.is_empty() {
                    return Err("responsibilityId must not be empty".to_string());
                }
                if responsibility_id.len() > 256 {
                    return Err("responsibilityId must be at most 256 bytes".to_string());
                }
                if responsibility_id
                    .bytes()
                    .any(|b| b == 0 || b.is_ascii_control())
                {
                    return Err(
                        "responsibilityId must not contain NUL or control characters".to_string(),
                    );
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_notification_only_with_zero_model_calls() {
        let policy = MonitorInferencePolicy::default();
        assert!(!policy.inference_allowed());
        assert_eq!(MonitorInferencePolicy::model_calls_for_unchanged_poll(), 0);
        assert_eq!(policy.model_calls_for_changed_event(), 0);
    }

    #[test]
    fn explicit_responsibility_still_accounts_zero_at_this_layer() {
        let policy = MonitorInferencePolicy::ExplicitResponsibility {
            responsibility_id: "resp-1".to_string(),
        };
        assert!(policy.inference_allowed());
        assert_eq!(policy.model_calls_for_changed_event(), 0);
        assert!(policy.validate().is_ok());
        assert!(
            MonitorInferencePolicy::ExplicitResponsibility {
                responsibility_id: "".to_string()
            }
            .validate()
            .is_err()
        );
    }
}
