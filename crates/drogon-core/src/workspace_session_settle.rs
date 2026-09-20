//! What a Workspace still owns when something is about to delete it
//! (issue #621). `worktree.remove` unlinks a checkout directory that live
//! PTYs may be sitting in, so it asks here before touching git, files or
//! registration — the check `project.remove` has always made through
//! [`crate::quick_session_delete`], stated once for any workspace id.
//!
//! The evidence rules are the liveness rules. A retained handle whose child
//! has not been reaped is proof of life. A row recorded as not-exited that
//! this process holds no handle for is `unverifiable`, never "probably
//! gone": loss of contact is not evidence of exit.
//!
//! A terminal is placed three ways, cheapest first: the Workspace that owns
//! it, the directory it was spawned in, and — for a child that looks
//! outside — the directory the OS says it is in now, since a shell can be
//! driven somewhere else after it starts.
//!
//! Known limits, all of one shape: a delete can only settle what something
//! can place.
//!
//! * A Workspace row spelled through a symlink that has since been deleted
//!   resolves nowhere and reads lexically outside the checkout. No current
//!   writer stores such a spelling — they all canonicalize — and nothing
//!   left on disk could place it.
//! * The live lookup answers for the PTY's own child, on the platforms that
//!   can answer (`lsof`, `/proc`). A grandchild that wandered in, or a
//!   platform that cannot say, leaves the recorded directory standing.
//! * Nothing can hold the answer still: a process may `chdir` between the
//!   check and the unlink. "No live process is standing here" is not a
//!   property any check can guarantee.
//!
//! What this module does guarantee is the one the bug was about: the
//! terminals Drogon opened for that workspace, and the ones it can see
//! standing in that directory, are settled or the delete refuses.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::{Engine, error};
use drogon_protocol::RpcError;
use serde_json::json;

/// The marker the desktop's `unstopped-pty` toast keys its proven-live copy
/// on (`delete-worktree-toast.ts`'s `isProvenLivePtyRemovalError`). The two
/// wordings are one string apart, so the constant carries the contract and
/// `proven_live_refusal_carries_the_renderer_marker` holds it.
pub(crate) const PROVEN_LIVE_MARKER: &str = "still live:";

/// The matching marker for the case the same toast calls "could not confirm
/// every terminal has exited" — a workspace whose records name sessions this
/// process cannot act on at all.
pub(crate) const UNVERIFIABLE_MARKER: &str = "could not confirm every terminal";

/// What a delete is about to take: the Workspaces whose registration goes,
/// and the directory whose files go with it (none, for a removal that only
/// unregisters). Both matter, because they answer different questions — a
/// row says which terminals belong to the card, and the directory says
/// which terminals are standing in what is about to be unlinked.
pub(crate) struct DeletionScope {
    pub(crate) workspace_ids: Vec<String>,
    pub(crate) directory: Option<PathBuf>,
}

impl DeletionScope {
    /// A removal that unregisters and deletes nothing on disk.
    pub(crate) fn registration_only(workspace_id: &str) -> Self {
        Self {
            workspace_ids: vec![workspace_id.to_string()],
            directory: None,
        }
    }
}

/// What one workspace still owns at the moment a delete asks.
#[derive(Default)]
pub(crate) struct WorkspaceSessionEvidence {
    /// `(session id, incarnation)` this process holds an unreaped PTY for,
    /// in id order. A stop can settle these.
    pub(crate) live: Vec<(String, String)>,
    /// Session ids recorded as not-exited whose fate this process cannot
    /// establish — no retained handle, or a handle from a different run.
    /// No signal from here can settle these.
    pub(crate) unverifiable: Vec<String>,
}

impl WorkspaceSessionEvidence {
    /// The refusal a delete owes its caller, or `None` when the workspace
    /// holds nothing that a delete would orphan.
    ///
    /// `forced` only changes the advice, never the verdict: a caller who
    /// already forced must not be told to force. Force stops the terminals
    /// this process holds, so it is the way out of a proven-live refusal and
    /// no help at all against a record this process cannot act on — saying
    /// otherwise sends someone back to a button that just failed.
    pub(crate) fn refusal(&self, forced: bool) -> Option<RpcError> {
        if !self.live.is_empty() {
            let ids: Vec<&str> = self.live.iter().map(|(id, _)| id.as_str()).collect();
            let advice = if forced {
                "Drogon signalled them and could not confirm they exited."
            } else {
                "Delete with force to stop them first."
            };
            return Some(RpcError::new(
                "session_live",
                format!(
                    "This workspace still has running terminals, so nothing was deleted — {PROVEN_LIVE_MARKER} {}. {advice}",
                    ids.join(", ")
                ),
            ));
        }
        if !self.unverifiable.is_empty() {
            return Some(RpcError::new(
                "session_unverifiable",
                format!(
                    "Drogon {UNVERIFIABLE_MARKER} in this workspace has exited, so nothing was deleted: {}. Force cannot settle a terminal Drogon has lost contact with — close those terminals, then delete again.",
                    self.unverifiable.join(", ")
                ),
            ));
        }
        None
    }
}

impl Engine {
    /// Reads the workspace's unsettled sessions. The DB rows are read before
    /// the handle map is locked: nothing here may hold both locks, because
    /// the session poller persists an observed exit (a DB write) while its
    /// handle is reachable.
    pub(crate) fn workspace_session_evidence(
        &self,
        scope: &DeletionScope,
    ) -> Result<WorkspaceSessionEvidence, RpcError> {
        let workspace_ids: BTreeSet<&str> =
            scope.workspace_ids.iter().map(String::as_str).collect();
        let rows: Vec<(String, String)> = {
            let conn = self.db.lock().unwrap();
            let mut statement = conn
                .prepare(
                    "SELECT id, incarnation FROM sessions
                     WHERE workspace_id = ?1 AND verdict != 'exited' ORDER BY id",
                )
                .map_err(error::from_sqlite)?;
            let mut rows = Vec::new();
            for workspace_id in &workspace_ids {
                let mapped = statement
                    .query_map([workspace_id], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(error::from_sqlite)?;
                for row in mapped {
                    rows.push(row.map_err(error::from_sqlite)?);
                }
            }
            rows.sort();
            rows
        };

        let mut evidence = WorkspaceSessionEvidence::default();
        let handles = self.sessions.lock().unwrap();
        // Handles are the liveness authority, not the rows: the poller
        // persists an exit after observing it, so a row can lag a real exit,
        // and `session.start` records `pending` before the first output. A
        // retained, unreaped child is live whatever its row currently says.
        let mut live_ids = BTreeSet::new();
        for handle in handles.values() {
            // Either the card owns it, or it is standing in the directory
            // about to be unlinked: `session.start` takes an explicit cwd
            // anywhere inside its workspace root, so a terminal opened into
            // this checkout from a workspace registered above it belongs to
            // this delete too (found by the adversarial pass on #621).
            let owned = workspace_ids.contains(handle.workspace_id.as_str());
            let standing_in_it = !owned
                && scope
                    .directory
                    .as_ref()
                    .is_some_and(|directory| standing_in(handle, directory));
            if (owned || standing_in_it) && !handle.is_exited() {
                live_ids.insert(handle.session_id.clone());
                evidence
                    .live
                    .push((handle.session_id.clone(), handle.incarnation.clone()));
            }
        }
        evidence.live.sort();
        for (id, incarnation) in rows {
            if live_ids.contains(&id) {
                continue;
            }
            match handles.get(&id) {
                // Reaped child, row not yet caught up: the poller owns that
                // write, and the process this row named is gone.
                Some(handle) if handle.incarnation == incarnation => {}
                // No handle, or one belonging to a different run: this
                // process cannot say what became of the recorded one.
                _ => evidence.unverifiable.push(id),
            }
        }
        Ok(evidence)
    }

    /// Stops every terminal in scope this process can act on. Call it under
    /// the workspace admission write gate, or a session admitted mid-delete
    /// would land in the directory being unlinked.
    ///
    /// It reports nothing about the outcome on purpose: the caller re-reads
    /// the evidence afterwards and refuses on whatever is left, so a stop
    /// that did not confirm an exit is judged by the same rule as a session
    /// nobody stopped. There is exactly one place that decides whether a
    /// workspace is safe to delete.
    pub(crate) fn settle_workspace_sessions(&self, scope: &DeletionScope) -> Result<(), RpcError> {
        for (id, incarnation) in self.workspace_session_evidence(scope)?.live {
            self.do_session_stop(&json!({"sessionId": id, "incarnation": incarnation}))?;
        }
        Ok(())
    }

    /// Every registered Workspace whose directory *is* `root` or sits inside
    /// it, including `root`'s own row. Deleting a checkout deletes their
    /// files too, so their terminals belong to that delete: a Project added
    /// at a subdirectory, or a folder registered under the checkout, has its
    /// own workspace row and would otherwise be invisible to a scope keyed
    /// on one id — which is how the adversarial pass on #621 still orphaned
    /// a live PTY through a forced remove.
    pub(crate) fn deletion_scope_for(&self, directory: &Path) -> Result<DeletionScope, RpcError> {
        Ok(DeletionScope {
            workspace_ids: self.workspaces_within(directory)?,
            directory: Some(resolved(directory)),
        })
    }

    fn workspaces_within(&self, root: &Path) -> Result<Vec<String>, RpcError> {
        let rows: Vec<(String, String)> = {
            let conn = self.db.lock().unwrap();
            let mut statement = conn
                .prepare("SELECT id, path FROM workspaces ORDER BY id")
                .map_err(error::from_sqlite)?;
            let mapped = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(error::from_sqlite)?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(error::from_sqlite)?
        };
        let raw_root = root.to_path_buf();
        let root = resolved(root);
        Ok(rows
            .into_iter()
            .filter(|(_, path)| {
                // Either spelling of either side may be the one they share:
                // the recorded root is not always canonical, and neither is
                // a recorded row.
                let raw = Path::new(path);
                let real = resolved(raw);
                is_within(&real, &root)
                    || is_within(&real, &raw_root)
                    || is_within(raw, &root)
                    || is_within(raw, &raw_root)
            })
            .map(|(id, _)| id)
            .collect())
    }
}

/// Symlinks make two spellings of one directory, and a delete must see
/// through that.
///
/// A path that no longer exists cannot be canonicalized, and keeping its
/// recorded spelling is not enough: compared against a canonical root, a
/// row written through a symlinked parent drops straight out of scope, and
/// the delete orphans its terminals — which is how the adversarial pass on
/// #621 still unlinked a checkout under a live PTY. So resolve as much of
/// the path as survives and re-attach the rest; only the surviving
/// ancestors can say where the directory was.
fn resolved(path: &Path) -> PathBuf {
    if let Ok(real) = std::fs::canonicalize(path) {
        return real;
    }
    let mut trailing = Vec::new();
    let mut cursor = path;
    while let (Some(parent), Some(name)) = (cursor.parent(), cursor.file_name()) {
        trailing.push(name.to_owned());
        if let Ok(mut real) = std::fs::canonicalize(parent) {
            real.extend(trailing.iter().rev());
            return real;
        }
        cursor = parent;
    }
    path.to_path_buf()
}

/// Whether this child is standing in the directory about to be unlinked.
///
/// The recorded spawn directory answers first because it costs nothing. It
/// is only where the child *started*, though, so one that looks outside
/// gets a second question put to the OS: a shell driven with `cd` into the
/// checkout is exactly the terminal this delete must not pull the floor
/// out from under. A platform that cannot answer leaves the recorded
/// directory standing rather than inventing a verdict.
fn standing_in(handle: &crate::session::SessionHandle, directory: &Path) -> bool {
    if is_within(&resolved(Path::new(&handle.cwd)), directory) {
        return true;
    }
    handle
        .child_process_id()
        .and_then(crate::ports::live_process_cwd)
        .is_some_and(|live| is_within(&resolved(Path::new(&live)), directory))
}

/// `starts_with` on components, never on the string: `/repo/feature-2` is
/// not inside `/repo/feature`.
fn is_within(candidate: &Path, root: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live(id: &str) -> WorkspaceSessionEvidence {
        WorkspaceSessionEvidence {
            live: vec![(id.to_string(), "inc_1".to_string())],
            unverifiable: vec![],
        }
    }

    #[test]
    fn proven_live_refusal_carries_the_renderer_marker() {
        let refusal = live("ses_1")
            .refusal(false)
            .expect("a live session refuses");
        assert_eq!(refusal.code, "session_live");
        assert_eq!(
            PROVEN_LIVE_MARKER, "still live:",
            "the desktop toast's `isProvenLivePtyRemovalError` keys on this literal"
        );
        assert!(
            refusal.message.contains("still live:"),
            "the desktop toast classifies the proven-live case on this marker: {}",
            refusal.message
        );
        assert!(refusal.message.contains("ses_1"));
        assert!(refusal.message.contains("Delete with force"));
    }

    /// A caller who already forced has no force left to try; telling them to
    /// press it again is the one thing this message must not do.
    #[test]
    fn a_forced_refusal_never_prescribes_forcing_again() {
        let refusal = live("ses_1").refusal(true).expect("still live, refuses");
        assert_eq!(refusal.code, "session_live");
        assert!(refusal.message.contains(PROVEN_LIVE_MARKER));
        assert!(
            !refusal.message.contains("with force"),
            "a forced caller must not be sent back to force: {}",
            refusal.message
        );
    }

    #[test]
    fn unverifiable_refusal_never_claims_proven_life_or_promises_force() {
        let evidence = WorkspaceSessionEvidence {
            live: vec![],
            unverifiable: vec!["ses_ghost".to_string()],
        };
        for forced in [false, true] {
            let refusal = evidence
                .refusal(forced)
                .expect("an unverifiable row refuses");
            assert_eq!(refusal.code, "session_unverifiable");
            assert_eq!(
                UNVERIFIABLE_MARKER, "could not confirm every terminal",
                "the desktop toast's `isUnsettledSessionRemovalError` keys on this literal"
            );
            assert!(refusal.message.contains("could not confirm every terminal"));
            assert!(
                !refusal.message.contains(PROVEN_LIVE_MARKER),
                "loss of contact must not render as proven-live copy: {}",
                refusal.message
            );
            // Force refuses this case identically, so the text may not offer
            // it as the way out — `close those terminals` is.
            assert!(
                refusal.message.contains("close those terminals"),
                "the message must name the recovery that exists: {}",
                refusal.message
            );
            assert!(!refusal.message.contains("Delete with force"));
        }
    }

    // Unix-only: Windows CI compiles this lib test target, and
    // `std::os::unix::fs::symlink` does not exist there.
    #[cfg(unix)]
    #[test]
    fn a_deleted_directory_is_still_placed_by_its_surviving_ancestors() {
        let root = tempfile::tempdir().unwrap();
        let real = std::fs::canonicalize(root.path()).unwrap();
        let alias = real.join("alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        // `<alias>/gone/deeper` never existed; only `<alias>` resolves.
        assert_eq!(
            resolved(&alias.join("gone").join("deeper")),
            real.join("gone").join("deeper"),
            "a vanished path keeps its place under the resolved ancestor"
        );
        assert_eq!(resolved(&alias), real);
    }

    #[test]
    fn a_registration_only_scope_places_no_directory() {
        // A folder section deletes no files, so nothing is "standing in" it
        // and only its own row is answerable.
        let scope = DeletionScope::registration_only("ws_1");
        assert_eq!(scope.workspace_ids, vec!["ws_1".to_string()]);
        assert!(scope.directory.is_none());
    }

    #[test]
    fn containment_is_by_path_component_not_by_prefix_string() {
        let root = Path::new("/repo/feature");
        assert!(is_within(Path::new("/repo/feature"), root));
        assert!(is_within(Path::new("/repo/feature/nested/app"), root));
        assert!(!is_within(Path::new("/repo/feature-2"), root));
        assert!(!is_within(Path::new("/repo"), root));
    }

    #[test]
    fn a_settled_workspace_raises_nothing() {
        assert!(WorkspaceSessionEvidence::default().refusal(false).is_none());
        assert!(WorkspaceSessionEvidence::default().refusal(true).is_none());
    }
}
