// MIT Copyright (c) 2026 Lovecast Inc.
//
// Harness conversation-store inspection for the Bot reopen path.
//
// A closed Bot session reopens through the harness's own continue
// entrypoint (`claude --continue`, `pi --continue`, ...). Claude Code (and
// the other CLIs) treat that as a request to reopen the most recent
// conversation in the session's working directory: when the Bot's home has
// no such conversation yet -- a home provisioned moments ago, or one whose
// earlier sessions never persisted a transcript -- the CLI refuses to start
// and exits with an error instead of opening a fresh interactive session.
// That is a hard "the Bot session does not start", so the launch planner
// must degrade the resume to a normal start whenever the harness's own
// store positively says there is nothing to resume.
//
// Pi is worse than a refusal and is the reason this module is not
// Claude-only: `pi --continue` is `SessionManager.continueRecent(cwd)`, and
// with nothing to continue it does not fail -- it opens a BRAND NEW session,
// silently. A pane that asked to resume would show an empty conversation and
// claim nothing. Modeling Pi's store turns that silence into the same
// positive absence the planner already knows how to state out loud.
//
// The contract is deliberately three-valued: a layout this module does not
// model returns `None` and keeps the caller's resume request, never a
// guessed answer. Only a positive absence (`Some(false)`) degrades.

use std::path::{Path, PathBuf};

use crate::HarnessId;

/// The directory name Claude Code derives from a session's working
/// directory: every character that is not an ASCII letter or digit becomes
/// `-`. Measured against the installed build's own `~/.claude/projects`
/// (e.g. `/Users/x/My.Project` -> `-Users-x-My-Project`), and the same shape
/// the reference's transcript-path reconstruction assumes.
pub fn claude_project_dir_name(cwd: &Path) -> String {
    cwd.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// The directory name Pi derives from a session's working directory: the
/// leading separator is dropped, every remaining `/`, `\` or `:` becomes
/// `-`, and the result is wrapped in `--` (Pi's `getDefaultSessionDirPath`).
/// Spaces are kept: measured against the installed build's own
/// `~/.pi/agent/sessions/--Users-x-Application Support-…--` layout.
pub fn pi_project_dir_name(cwd: &Path) -> String {
    let text = cwd.to_string_lossy();
    let mut name = String::from("--");
    for (index, character) in text.chars().enumerate() {
        if index == 0 && matches!(character, '/' | '\\') {
            continue;
        }
        name.push(if matches!(character, '/' | '\\' | ':') {
            '-'
        } else {
            character
        });
    }
    name.push_str("--");
    name
}

fn has_jsonl_transcript(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .path()
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
    })
}

/// Whether `probe` finds a conversation for `cwd`, or for the canonical
/// spelling of it.
///
/// The daemon stores a workspace path exactly as it was registered, while a
/// CLI resolves its own working directory through the OS: on macOS
/// `/var/folders/...` is really `/private/var/folders/...`, and the harness's
/// store is keyed by what the CLI saw. Both spellings name the same project,
/// so a hit under either one is a positive answer; only a miss in BOTH is an
/// absence (and a miss is what makes the planner degrade the resume).
fn conversation_exists_for_either_spelling(cwd: &Path, probe: impl Fn(&Path) -> bool) -> bool {
    if probe(cwd) {
        return true;
    }
    match std::fs::canonicalize(cwd) {
        Ok(canonical) if canonical != cwd => probe(&canonical),
        _ => false,
    }
}

/// Whether Claude Code has a conversation it would resume for `cwd` under
/// the given config root (`$CLAUDE_CONFIG_DIR`, else `~/.claude`). A missing
/// root or project directory is a positive "nothing to resume".
pub fn claude_conversation_exists(config_root: &Path, cwd: &Path) -> bool {
    conversation_exists_for_either_spelling(cwd, |cwd| {
        has_jsonl_transcript(
            &config_root
                .join("projects")
                .join(claude_project_dir_name(cwd)),
        )
    })
}

/// Whether Pi has a conversation `pi --continue` would reopen for `cwd`
/// under the given agent root (`$PI_CODING_AGENT_DIR`, else
/// `~/.pi/agent`). A missing root or project directory is a positive
/// "nothing to continue" -- the case where Pi would otherwise open a new
/// session without saying so.
pub fn pi_conversation_exists(agent_root: &Path, cwd: &Path) -> bool {
    conversation_exists_for_either_spelling(cwd, |cwd| {
        has_jsonl_transcript(&agent_root.join("sessions").join(pi_project_dir_name(cwd)))
    })
}

/// Caller-resolved store roots, so tests can point each harness at a private
/// directory. `None` falls back to the process environment (`$CLAUDE_CONFIG_DIR`
/// / `$HOME/.claude`, `$PI_CODING_AGENT_DIR` / `$HOME/.pi/agent`).
#[derive(Clone, Copy, Default)]
pub struct ResumeStoreRoots<'a> {
    pub claude_config: Option<&'a Path>,
    pub pi_agent: Option<&'a Path>,
}

/// Three-valued answer to "would this harness's continue entrypoint find a
/// prior conversation in `cwd`?".
///
/// - `Some(true)`: the store holds one; the resume request is honored.
/// - `Some(false)`: the store exists for this harness and holds none for
///   `cwd`; the caller must start fresh, not request a resume.
/// - `None`: this harness's on-disk transcript layout is not modeled here,
///   so the resume request is kept exactly as asked (honest, never guessed).
pub fn resumable_conversation_exists(
    harness_id: HarnessId,
    cwd: &Path,
    roots: ResumeStoreRoots<'_>,
) -> Option<bool> {
    match harness_id {
        HarnessId::Claude => {
            let root = roots
                .claude_config
                .map(Path::to_path_buf)
                .or_else(default_claude_config_root)?;
            // An unreadable/missing HOME is not proof of absence: keep the
            // caller's request rather than degrade on a missing environment.
            Some(claude_conversation_exists(&root, cwd))
        }
        HarnessId::Pi => {
            let root = roots
                .pi_agent
                .map(Path::to_path_buf)
                .or_else(default_pi_agent_root)?;
            Some(pi_conversation_exists(&root, cwd))
        }
        HarnessId::Opencode | HarnessId::Antigravity | HarnessId::Codex => None,
    }
}

/// `$PI_CODING_AGENT_DIR` when set and non-empty, else `$HOME/.pi/agent`.
fn default_pi_agent_root() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("PI_CODING_AGENT_DIR")
        && !configured.is_empty()
    {
        return Some(PathBuf::from(configured));
    }
    let home = std::env::var_os("HOME")?;
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home).join(".pi").join("agent"))
}

/// `$CLAUDE_CONFIG_DIR` when set and non-empty, else `$HOME/.claude`.
fn default_claude_config_root() -> Option<PathBuf> {
    if let Some(configured) = std::env::var_os("CLAUDE_CONFIG_DIR")
        && !configured.is_empty()
    {
        return Some(PathBuf::from(configured));
    }
    let home = std::env::var_os("HOME")?;
    if home.is_empty() {
        return None;
    }
    Some(PathBuf::from(home).join(".claude"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_dir_name_replaces_every_non_alphanumeric_byte() {
        assert_eq!(
            claude_project_dir_name(Path::new("/Users/example/Documents/Drogon-rewrite")),
            "-Users-example-Documents-Drogon-rewrite"
        );
        assert_eq!(
            claude_project_dir_name(Path::new("/private/var/folders/x/T/tmp.4mnHQS")),
            "-private-var-folders-x-T-tmp-4mnHQS"
        );
    }

    #[test]
    fn a_missing_project_dir_is_a_positive_absence() {
        let root = tempfile::tempdir().unwrap();
        assert!(!claude_conversation_exists(
            root.path(),
            Path::new("/tmp/nowhere")
        ));
        assert_eq!(
            resumable_conversation_exists(
                HarnessId::Claude,
                Path::new("/tmp/nowhere"),
                ResumeStoreRoots {
                    claude_config: Some(root.path()),
                    ..ResumeStoreRoots::default()
                }
            ),
            Some(false)
        );
    }

    #[test]
    fn any_jsonl_transcript_counts_as_resumable() {
        let root = tempfile::tempdir().unwrap();
        let cwd = Path::new("/tmp/my-project");
        let project = root
            .path()
            .join("projects")
            .join(claude_project_dir_name(cwd));
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("notes.txt"), "not a transcript\n").unwrap();
        assert_eq!(
            resumable_conversation_exists(
                HarnessId::Claude,
                cwd,
                ResumeStoreRoots {
                    claude_config: Some(root.path()),
                    ..ResumeStoreRoots::default()
                }
            ),
            Some(false),
            "a non-transcript file must not be mistaken for a conversation"
        );
        std::fs::write(
            project.join("11111111-2222-3333-4444-555555555555.jsonl"),
            "{}\n",
        )
        .unwrap();
        assert_eq!(
            resumable_conversation_exists(
                HarnessId::Claude,
                cwd,
                ResumeStoreRoots {
                    claude_config: Some(root.path()),
                    ..ResumeStoreRoots::default()
                }
            ),
            Some(true)
        );
    }

    /// Pi's project directory name is NOT Claude's: spaces survive, the
    /// leading separator is dropped and the whole name is wrapped in `--`.
    /// Measured against the installed build's own session tree.
    #[test]
    fn pi_project_dir_name_matches_the_installed_layout() {
        assert_eq!(
            pi_project_dir_name(Path::new(
                "/Users/example/Library/Application Support/Drogon/workspaces/Drogon/issue-619-2"
            )),
            "--Users-example-Library-Application Support-Drogon-workspaces-Drogon-issue-619-2--"
        );
        assert_eq!(pi_project_dir_name(Path::new("/tmp/x")), "--tmp-x--");
    }

    /// `pi --continue` opens a NEW session when its store has nothing to
    /// continue (it does not refuse), so a positive absence is the only way
    /// the planner can avoid claiming a resume that silently started over.
    #[test]
    fn pi_reports_a_positive_absence_when_nothing_can_be_continued() {
        let root = tempfile::tempdir().unwrap();
        let cwd = Path::new("/tmp/pi-project");
        let roots = ResumeStoreRoots {
            pi_agent: Some(root.path()),
            ..ResumeStoreRoots::default()
        };
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, cwd, roots),
            Some(false),
            "a missing sessions dir is a positive 'nothing to continue'"
        );

        let project = root.path().join("sessions").join(pi_project_dir_name(cwd));
        std::fs::create_dir_all(&project).unwrap();
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, cwd, roots),
            Some(false),
            "an empty project dir still has nothing to continue"
        );
        std::fs::write(project.join("notes.txt"), "not a transcript\n").unwrap();
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, cwd, roots),
            Some(false)
        );
        std::fs::write(
            project.join("2026-09-20T22-36-05-857Z_01a0c0f6-5b60-72e7-8dc5-a9ed89ce5409.jsonl"),
            "{}\n",
        )
        .unwrap();
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, cwd, roots),
            Some(true)
        );
        // Another project's sessions never count for this cwd.
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, Path::new("/tmp/other"), roots),
            Some(false)
        );
    }

    /// The daemon keeps the workspace path as registered; a CLI keys its own
    /// store by the directory the OS reports. On macOS those differ for
    /// `/var/...` vs `/private/var/...`, and a probe that only tried one
    /// spelling would decline a resume the harness could have served.
    #[cfg(unix)]
    #[test]
    fn a_conversation_under_the_canonical_spelling_still_counts() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("real-project");
        std::fs::create_dir_all(&real).unwrap();
        let link = root.path().join("linked-project");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let store = root
            .path()
            .join("sessions")
            .join(pi_project_dir_name(&std::fs::canonicalize(&real).unwrap()));
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(store.join("conv.jsonl"), "{}\n").unwrap();

        let roots = ResumeStoreRoots {
            pi_agent: Some(root.path()),
            ..ResumeStoreRoots::default()
        };
        // The symlinked spelling is what a registered workspace may hold; the
        // store was written under the canonical one.
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, &link, roots),
            Some(true),
            "a hit under the canonical spelling is still a conversation"
        );
        assert_eq!(
            resumable_conversation_exists(HarnessId::Pi, &real, roots),
            Some(true)
        );
    }

    #[test]
    fn unmodeled_harness_layouts_keep_the_resume_request() {
        let root = tempfile::tempdir().unwrap();
        for harness_id in [
            HarnessId::Opencode,
            HarnessId::Antigravity,
            HarnessId::Codex,
        ] {
            assert_eq!(
                resumable_conversation_exists(
                    harness_id,
                    Path::new("/tmp/x"),
                    ResumeStoreRoots {
                        claude_config: Some(root.path()),
                        pi_agent: Some(root.path()),
                    }
                ),
                None,
                "{harness_id:?} must keep the caller's resume request"
            );
        }
    }
}
