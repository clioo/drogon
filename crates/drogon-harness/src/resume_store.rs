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

/// Whether Claude Code has a conversation it would resume for `cwd` under
/// the given config root (`$CLAUDE_CONFIG_DIR`, else `~/.claude`). A missing
/// root or project directory is a positive "nothing to resume".
pub fn claude_conversation_exists(config_root: &Path, cwd: &Path) -> bool {
    has_jsonl_transcript(
        &config_root
            .join("projects")
            .join(claude_project_dir_name(cwd)),
    )
}

/// Three-valued answer to "would this harness's continue entrypoint find a
/// prior conversation in `cwd`?".
///
/// - `Some(true)`: the store holds one; the resume request is honored.
/// - `Some(false)`: the store exists for this harness and holds none for
///   `cwd`; the caller must start fresh, not request a resume.
/// - `None`: this harness's on-disk transcript layout is not modeled here,
///   so the resume request is kept exactly as asked (honest, never guessed).
///
/// `claude_config_root` is the caller-resolved Claude Code config directory
/// (so tests can point it at a private root); pass `None` to fall back to
/// `$CLAUDE_CONFIG_DIR` / `$HOME/.claude` from this process's environment.
pub fn resumable_conversation_exists(
    harness_id: HarnessId,
    cwd: &Path,
    claude_config_root: Option<&Path>,
) -> Option<bool> {
    match harness_id {
        HarnessId::Claude => {
            let root = claude_config_root
                .map(Path::to_path_buf)
                .or_else(default_claude_config_root)?;
            // An unreadable/missing HOME is not proof of absence: keep the
            // caller's request rather than degrade on a missing environment.
            Some(claude_conversation_exists(&root, cwd))
        }
        HarnessId::Pi | HarnessId::Opencode | HarnessId::Antigravity | HarnessId::Codex => None,
    }
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
            claude_project_dir_name(Path::new("/Users/carlos/Documents/Drogon-rewrite")),
            "-Users-carlos-Documents-Drogon-rewrite"
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
                Some(root.path())
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
            resumable_conversation_exists(HarnessId::Claude, cwd, Some(root.path())),
            Some(false),
            "a non-transcript file must not be mistaken for a conversation"
        );
        std::fs::write(
            project.join("11111111-2222-3333-4444-555555555555.jsonl"),
            "{}\n",
        )
        .unwrap();
        assert_eq!(
            resumable_conversation_exists(HarnessId::Claude, cwd, Some(root.path())),
            Some(true)
        );
    }

    #[test]
    fn unmodeled_harness_layouts_keep_the_resume_request() {
        let root = tempfile::tempdir().unwrap();
        for harness_id in [
            HarnessId::Pi,
            HarnessId::Opencode,
            HarnessId::Antigravity,
            HarnessId::Codex,
        ] {
            assert_eq!(
                resumable_conversation_exists(harness_id, Path::new("/tmp/x"), Some(root.path())),
                None,
                "{harness_id:?} must keep the caller's resume request"
            );
        }
    }
}
