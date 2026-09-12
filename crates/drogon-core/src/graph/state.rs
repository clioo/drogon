//! Derives the graph's `state` half from REAL observation: the daemon's own
//! Mentu run rows (including the live progress mirror PR #441 writes every
//! 500 ms) and this process's child registry. Node status is never taken
//! from what `intent` wishes were true.
//!
//! Liveness rule: a node is `running` only while this daemon holds a
//! confirmed live child for its run. A `running` row with no tracked child
//! is loss of contact and is reported `unverifiable`, never `failed` and
//! never `succeeded`.

use std::collections::HashMap;

use drogon_protocol::graph::{
    GraphIntent, GraphNodeState, GraphNodeStatus, GraphRuntimeRef, GraphState,
};
use drogon_protocol::mentu::{MentuRun, MentuRunStatus, MentuStepRun};

use super::storage::NodeRunMapping;

/// Projects the whole `state` half.
///
/// * `live` answers whether this daemon currently holds the run's child.
/// * An intent node with no run is `idle` when enabled and `blocked` when
///   disabled.
/// * A node whose intent entry was deleted but whose run is still live stays
///   in `state` (deleting an intent node never kills a running worker); once
///   that run settles the orphan entry is dropped.
pub fn project(
    intent: &GraphIntent,
    mappings: &[NodeRunMapping],
    runs: &HashMap<String, MentuRun>,
    runtimes: &HashMap<String, GraphRuntimeRef>,
    live: &dyn Fn(&str) -> bool,
    updated_at: &str,
) -> GraphState {
    let mut nodes: Vec<GraphNodeState> = Vec::new();
    // Intent order first, so the state list mirrors the intent list.
    for node in &intent.nodes {
        let mapping = mappings.iter().find(|m| m.node_id == node.id);
        nodes.push(project_node(
            &node.id,
            node.enabled,
            mapping,
            runs,
            runtimes,
            live,
        ));
    }
    // Orphaned nodes: not in intent any more, but whose run is still live (or
    // lost contact). Once the run settles the entry is dropped.
    for mapping in mappings {
        if intent.node(&mapping.node_id).is_some() {
            continue;
        }
        let pending = runs
            .get(&mapping.run_id)
            .is_some_and(|run| run.status == MentuRunStatus::Running);
        if !pending {
            continue;
        }
        nodes.push(project_node(
            &mapping.node_id,
            false,
            Some(mapping),
            runs,
            runtimes,
            live,
        ));
    }
    GraphState {
        updated_at: updated_at.to_string(),
        nodes,
    }
}

/// F0: attributes which runtime actually ran the node's latest launch onto
/// whatever status `project_node_status_and_error` already decided — a node
/// never launched carries no attribution at all (nothing to attribute),
/// every other node does, regardless of its outcome.
fn project_node(
    node_id: &str,
    enabled: bool,
    mapping: Option<&NodeRunMapping>,
    runs: &HashMap<String, MentuRun>,
    runtimes: &HashMap<String, GraphRuntimeRef>,
    live: &dyn Fn(&str) -> bool,
) -> GraphNodeState {
    let mut state = project_node_status_and_error(node_id, enabled, mapping, runs, live);
    if mapping.is_some()
        && let Some(runtime) = runtimes.get(node_id)
    {
        state.harness = Some(runtime.harness.clone());
        state.model = Some(runtime.model.clone());
        state.is_free_default_runtime = Some(*runtime == super::failover::default_free_runtime());
    }
    state
}

fn project_node_status_and_error(
    node_id: &str,
    enabled: bool,
    mapping: Option<&NodeRunMapping>,
    runs: &HashMap<String, MentuRun>,
    live: &dyn Fn(&str) -> bool,
) -> GraphNodeState {
    let Some(mapping) = mapping else {
        return GraphNodeState {
            id: node_id.to_string(),
            status: if enabled {
                GraphNodeStatus::Idle
            } else {
                GraphNodeStatus::Blocked
            },
            run_id: None,
            mentu_run_id: None,
            started_at: None,
            ended_at: None,
            evidence: None,
            last_error: if enabled {
                None
            } else {
                Some("This node is disabled; it will not be launched.".into())
            },
            harness: None,
            model: None,
            is_free_default_runtime: None,
        };
    };
    let Some(run) = runs.get(&mapping.run_id) else {
        // The mapping names a run row that no longer exists: nothing can be
        // confirmed about it.
        return base(
            node_id,
            GraphNodeStatus::Unverifiable,
            mapping.run_id.clone(),
            None,
        )
        .with_error("This node's run row is gone; the outcome cannot be confirmed.");
    };
    let step: Option<&MentuStepRun> = run
        .steps
        .iter()
        .rev()
        .find(|step| step.label == mapping.step_label);
    let status = project_status(run, step, live(&run.id));
    let mut state = base(node_id, status, run.id.clone(), Some(run.clone()));
    // `run.error` belongs to the RUN, not to every node mapped into it. Falling
    // back to it unconditionally stamped the one failing step's message onto
    // each sibling — including the nodes that succeeded — inside the `state`
    // half that exists to be observed truth. A node inherits the run-level
    // message only when the node itself failed and its own step recorded no
    // reason; every other status keeps its own explicit account below.
    state.last_error = step
        .and_then(|step| step.error.clone())
        .or_else(|| match status {
            GraphNodeStatus::Failed => run.error.clone(),
            _ => None,
        })
        .or_else(|| match status {
            GraphNodeStatus::Unverifiable => Some(
                "The daemon lost contact with this node's run; its outcome is unverifiable.".into(),
            ),
            GraphNodeStatus::Blocked if run.status == MentuRunStatus::Cancelled => {
                Some("The run was cancelled before this node ran.".into())
            }
            GraphNodeStatus::Blocked => {
                Some("An upstream node failed, so this node never started.".into())
            }
            _ => None,
        });
    state.evidence = step
        .and_then(|step| serde_json::to_value(step).ok())
        .map(|step| {
            serde_json::json!({
                "runId": run.id,
                "mentuRunId": run.mentu_run_id,
                "step": step,
            })
        });
    state
}

/// The status projection itself, isolated so every arm is unit-testable.
fn project_status(
    run: &MentuRun,
    step: Option<&MentuStepRun>,
    run_is_live: bool,
) -> GraphNodeStatus {
    match run.status {
        MentuRunStatus::Running => {
            if !run_is_live {
                // Loss of contact: never claimed as running/failed/succeeded.
                return GraphNodeStatus::Unverifiable;
            }
            match step {
                Some(step) => step_status(step),
                None => GraphNodeStatus::Idle,
            }
        }
        MentuRunStatus::Unavailable => GraphNodeStatus::Unverifiable,
        MentuRunStatus::Succeeded | MentuRunStatus::Failed | MentuRunStatus::Cancelled => {
            match step {
                Some(step) => match step.status {
                    MentuRunStatus::Succeeded => GraphNodeStatus::Succeeded,
                    MentuRunStatus::Failed => GraphNodeStatus::Failed,
                    MentuRunStatus::Running => {
                        // A settled run whose step still says running is not a
                        // live claim we can back.
                        GraphNodeStatus::Unverifiable
                    }
                    MentuRunStatus::Cancelled => GraphNodeStatus::Blocked,
                    MentuRunStatus::Unavailable => GraphNodeStatus::Unverifiable,
                },
                None if run.status == MentuRunStatus::Succeeded => {
                    // The run finished ok but this node has no step entry:
                    // nothing was observed for it, so do not claim success.
                    GraphNodeStatus::Unverifiable
                }
                None => GraphNodeStatus::Blocked,
            }
        }
    }
}

fn step_status(step: &MentuStepRun) -> GraphNodeStatus {
    match step.status {
        MentuRunStatus::Running => GraphNodeStatus::Running,
        MentuRunStatus::Succeeded => GraphNodeStatus::Succeeded,
        MentuRunStatus::Failed => GraphNodeStatus::Failed,
        MentuRunStatus::Cancelled => GraphNodeStatus::Blocked,
        MentuRunStatus::Unavailable => GraphNodeStatus::Unverifiable,
    }
}

fn base(
    node_id: &str,
    status: GraphNodeStatus,
    run_id: String,
    run: Option<MentuRun>,
) -> GraphNodeState {
    GraphNodeState {
        id: node_id.to_string(),
        status,
        run_id: Some(run_id),
        mentu_run_id: run.as_ref().and_then(|run| run.mentu_run_id.clone()),
        started_at: run.as_ref().map(|run| run.started_at.clone()),
        ended_at: run.as_ref().and_then(|run| run.ended_at.clone()),
        evidence: None,
        last_error: None,
        harness: None,
        model: None,
        is_free_default_runtime: None,
    }
}

trait WithError {
    fn with_error(self, message: impl Into<String>) -> Self;
}

impl WithError for GraphNodeState {
    fn with_error(mut self, message: impl Into<String>) -> Self {
        self.last_error = Some(message.into());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use drogon_protocol::graph::{GraphNodeIntent, GraphNodeProvider};
    use drogon_protocol::mentu::MentuStepRun;

    fn intent(ids: &[&str]) -> GraphIntent {
        GraphIntent {
            nodes: ids
                .iter()
                .map(|id| GraphNodeIntent {
                    id: (*id).into(),
                    title: (*id).into(),
                    harness: "shell".into(),
                    model: String::new(),
                    depends_on: vec![],
                    prompt: "echo".into(),
                    enabled: true,
                    provider: None::<GraphNodeProvider>,
                    verify_commands: vec![],
                })
                .collect(),
            ..GraphIntent::default()
        }
    }

    fn run(id: &str, status: MentuRunStatus, steps: Vec<MentuStepRun>) -> MentuRun {
        MentuRun {
            id: id.into(),
            workspace_id: "ws1".into(),
            recipe_id: "r".into(),
            approval_id: "a".into(),
            mentu_run_id: Some("run_x".into()),
            status,
            started_at: "t0".into(),
            ended_at: Some("t1".into()),
            steps,
            error: None,
            retry_of: None,
        }
    }

    fn step(label: &str, status: MentuRunStatus) -> MentuStepRun {
        MentuStepRun {
            label: label.into(),
            backend: "shell".into(),
            status,
            exit_code: Some(0),
            duration_seconds: Some(1),
            attempts: Some(1),
            output_path: None,
            error_path: None,
            error: None,
            verification: None,
            model: None,
            usage: None,
        }
    }

    fn runs(list: Vec<MentuRun>) -> HashMap<String, MentuRun> {
        list.into_iter().map(|run| (run.id.clone(), run)).collect()
    }

    fn live_always(_: &str) -> bool {
        true
    }

    fn live_never(_: &str) -> bool {
        false
    }

    #[test]
    fn an_intent_node_with_no_run_is_idle() {
        let state = project(
            &intent(&["n1"]),
            &[],
            &runs(vec![]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Idle);
        assert!(state.nodes[0].run_id.is_none());
        assert_eq!(state.updated_at, "now");
    }

    #[test]
    fn a_running_run_reports_the_step_it_reached() {
        let mapping = NodeRunMapping {
            node_id: "n1".into(),
            run_id: "r1".into(),
            step_label: "n1".into(),
        };
        let state = project(
            &intent(&["n1", "n2"]),
            std::slice::from_ref(&mapping),
            &runs(vec![run(
                "r1",
                MentuRunStatus::Running,
                vec![step("n1", MentuRunStatus::Succeeded)],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Succeeded);
        // n2 is part of the same compiled run but has not started: idle.
        assert_eq!(state.nodes[1].status, GraphNodeStatus::Idle);
    }

    #[test]
    fn loss_of_contact_is_unverifiable_never_running_or_failed() {
        let mapping = NodeRunMapping {
            node_id: "n1".into(),
            run_id: "r1".into(),
            step_label: "n1".into(),
        };
        let state = project(
            &intent(&["n1"]),
            &[mapping],
            &runs(vec![run(
                "r1",
                MentuRunStatus::Running,
                vec![step("n1", MentuRunStatus::Running)],
            )]),
            &HashMap::new(),
            &live_never,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Unverifiable);
        assert!(
            state.nodes[0]
                .last_error
                .as_deref()
                .unwrap()
                .contains("lost contact")
        );
    }

    #[test]
    fn a_failed_step_is_failed_and_a_downstream_node_is_blocked() {
        let mappings = vec![
            NodeRunMapping {
                node_id: "n1".into(),
                run_id: "r1".into(),
                step_label: "n1".into(),
            },
            NodeRunMapping {
                node_id: "n2".into(),
                run_id: "r1".into(),
                step_label: "n2".into(),
            },
        ];
        let state = project(
            &intent(&["n1", "n2"]),
            &mappings,
            &runs(vec![run(
                "r1",
                MentuRunStatus::Failed,
                vec![step("n1", MentuRunStatus::Failed)],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Failed);
        assert_eq!(state.nodes[1].status, GraphNodeStatus::Blocked);
    }

    #[test]
    fn a_node_that_succeeded_before_a_later_failure_still_reports_success() {
        let mappings = vec![
            NodeRunMapping {
                node_id: "n1".into(),
                run_id: "r1".into(),
                step_label: "n1".into(),
            },
            NodeRunMapping {
                node_id: "n2".into(),
                run_id: "r1".into(),
                step_label: "n2".into(),
            },
        ];
        let state = project(
            &intent(&["n1", "n2"]),
            &mappings,
            &runs(vec![run(
                "r1",
                MentuRunStatus::Failed,
                vec![
                    step("n1", MentuRunStatus::Succeeded),
                    step("n2", MentuRunStatus::Failed),
                ],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Succeeded);
        assert_eq!(state.nodes[1].status, GraphNodeStatus::Failed);
    }

    #[test]
    fn the_run_level_error_is_not_stamped_onto_nodes_that_did_not_fail() {
        // A graph QA pass found the one failing step's message rendered red as
        // "Last error" on every sibling node, including the ones that
        // succeeded, because the projection fell back to `run.error`
        // unconditionally. `state` is the observed-truth half: a node that
        // succeeded has no error of its own to report.
        let mappings = vec![
            NodeRunMapping {
                node_id: "n1".into(),
                run_id: "r1".into(),
                step_label: "n1".into(),
            },
            NodeRunMapping {
                node_id: "n2".into(),
                run_id: "r1".into(),
                step_label: "n2".into(),
            },
        ];
        let mut failing = run(
            "r1",
            MentuRunStatus::Failed,
            vec![
                step("n1", MentuRunStatus::Succeeded),
                step("n2", MentuRunStatus::Failed),
            ],
        );
        failing.error = Some("step n2 exited 1".into());
        let state = project(
            &intent(&["n1", "n2"]),
            &mappings,
            &runs(vec![failing]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Succeeded);
        assert_eq!(
            state.nodes[0].last_error, None,
            "a succeeded node must not inherit the run's failure message"
        );
        assert_eq!(state.nodes[1].status, GraphNodeStatus::Failed);
        assert_eq!(
            state.nodes[1].last_error.as_deref(),
            Some("step n2 exited 1"),
            "the node that actually failed still reports the run-level reason \
             when its own step recorded none"
        );
    }

    #[test]
    fn a_blocked_node_reports_its_own_reason_not_the_upstream_error() {
        // Same defect, the blocked path: the upstream's message used to win
        // over this node's honest "it never started" account.
        let mappings = vec![NodeRunMapping {
            node_id: "n2".into(),
            run_id: "r1".into(),
            step_label: "n2".into(),
        }];
        let mut failing = run(
            "r1",
            MentuRunStatus::Failed,
            vec![step("n2", MentuRunStatus::Cancelled)],
        );
        failing.error = Some("upstream n1 exited 1".into());
        let state = project(
            &intent(&["n2"]),
            &mappings,
            &runs(vec![failing]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Blocked);
        assert_eq!(
            state.nodes[0].last_error.as_deref(),
            Some("An upstream node failed, so this node never started.")
        );
    }

    #[test]
    fn the_newest_attempt_wins_when_a_step_was_retried() {
        // retry-step appends a second entry for the same label.
        let mapping = NodeRunMapping {
            node_id: "n2".into(),
            run_id: "r1".into(),
            step_label: "n2".into(),
        };
        let state = project(
            &intent(&["n2"]),
            &[mapping],
            &runs(vec![run(
                "r1",
                MentuRunStatus::Succeeded,
                vec![
                    step("n2", MentuRunStatus::Failed),
                    step("n2", MentuRunStatus::Succeeded),
                ],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Succeeded);
    }

    #[test]
    fn a_disabled_node_is_blocked_with_a_reason() {
        let mut graph = intent(&["n1"]);
        graph.nodes[0].enabled = false;
        let state = project(
            &graph,
            &[],
            &runs(vec![]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Blocked);
        assert!(state.nodes[0].last_error.is_some());
    }

    #[test]
    fn a_deleted_intent_node_stays_visible_while_its_run_is_live() {
        let mapping = NodeRunMapping {
            node_id: "gone".into(),
            run_id: "r1".into(),
            step_label: "gone".into(),
        };
        let state = project(
            &intent(&["n1"]),
            std::slice::from_ref(&mapping),
            &runs(vec![run(
                "r1",
                MentuRunStatus::Running,
                vec![step("gone", MentuRunStatus::Running)],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes.len(), 2);
        assert_eq!(state.nodes[1].id, "gone");
        assert_eq!(state.nodes[1].status, GraphNodeStatus::Running);

        // Once that run settles, the orphan entry is gone.
        let state = project(
            &intent(&["n1"]),
            &[mapping],
            &runs(vec![run(
                "r1",
                MentuRunStatus::Succeeded,
                vec![step("gone", MentuRunStatus::Succeeded)],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes.len(), 1);
        assert_eq!(state.nodes[0].id, "n1");
    }

    #[test]
    fn a_missing_run_row_is_unverifiable() {
        let mapping = NodeRunMapping {
            node_id: "n1".into(),
            run_id: "missing".into(),
            step_label: "n1".into(),
        };
        let state = project(
            &intent(&["n1"]),
            &[mapping],
            &runs(vec![]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Unverifiable);
    }

    #[test]
    fn a_cancelled_run_blocks_the_node_that_never_ran() {
        let mapping = NodeRunMapping {
            node_id: "n2".into(),
            run_id: "r1".into(),
            step_label: "n2".into(),
        };
        let state = project(
            &intent(&["n2"]),
            &[mapping],
            &runs(vec![run(
                "r1",
                MentuRunStatus::Cancelled,
                vec![step("n1", MentuRunStatus::Failed)],
            )]),
            &HashMap::new(),
            &live_always,
            "now",
        );
        assert_eq!(state.nodes[0].status, GraphNodeStatus::Blocked);
    }
}
