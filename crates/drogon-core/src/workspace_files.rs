//! Workspace-scoped file explorer/editor primitives. Ahead of the additive
//! RPC methods `protocol-v1.md` reserves for file read/write, this module
//! gives `list_dir`/`read_file`/`write_file` a caller-supplied workspace-root
//! boundary: every relative path is checked for traversal (`..`, absolute,
//! NUL) up front by `validate_rel`, and everything below that is a walk
//! through a single `cap_std::fs::Dir` handle opened once on the workspace
//! root (`open_root_dir`).
//!
//! TOCTOU closure: `Dir` resolves each path component against its own open
//! descriptor (openat-style), one at a time, rather than building a string
//! and re-resolving it against the live filesystem the way `std::fs` +
//! `canonicalize` does — there is no separate check-then-act step for a
//! concurrent actor to race. A `..`/absolute component, met while walking a
//! path or a symlink target, above the open root is refused outright.
//!
//! What this does NOT close: the single ambient `Dir::open_ambient_dir`
//! call in `open_root_dir` that turns the caller-supplied `root` into a
//! descriptor is itself one check-then-open step, and identity is pinned
//! only from that point down. If a *sibling*, fully-contained directory
//! gets swapped for a different fully-contained one between two separate
//! calls into this module (e.g. between `write_file`'s write and its later
//! read-back), both resolve successfully and neither is a violation `Dir`
//! can detect — containment, not identity-across-calls, is the guarantee.
//!
//! Symlink policy: a *relative*-target symlink that stays within the root
//! is followed by `cap_std`'s own resolver. An *absolute*-target symlink is
//! REFUSED UNCONDITIONALLY, even one that would itself resolve inside
//! `root` — `cap_std`'s sandbox has no notion of the root's real absolute
//! location to compare against. This is explicit UNMET behavior, not a
//! considered boundary. A prior attempt to close this gap was implemented
//! and reverted by root ruling; do not reintroduce it, and any future
//! attempt must not fall back to a string-canonicalize-and-compare
//! check-then-act step.
//!
//! No stat-then-open: `read_file` and `write_file`'s post-rename read-back
//! both go through `open_regular_file`, which opens non-blocking on unix
//! and validates the type from the metadata of the handle it actually got,
//! never from a path-based stat taken beforehand — a stat-then-open
//! sequence has a window where the target is swapped for something else
//! (e.g. a FIFO) in between, and a plain blocking open of a writer-less
//! FIFO hangs indefinitely regardless of what an earlier stat said. See
//! `open_regular_file`'s own doc for the non-unix fallback.
//!
//! `list_dir` stops enumerating as soon as it has `max_entries` results
//! rather than reading the whole directory and truncating afterward, so its
//! cost is bounded by `max_entries`, not by the directory's real size.
//!
//! `write_file`'s temp file is created with `create_new` (`O_EXCL`): its
//! name embeds a fresh UUID and should never already exist, so a collision
//! fails loudly instead of silently truncating whatever was there. Its
//! post-rename read-back is capped to `expected_len + 1` bytes rather than
//! reading a possibly-since-grown file in full.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
#[cfg(unix)]
use cap_std::fs::{OpenOptionsExt, Permissions, PermissionsExt};
use drogon_protocol::RpcError;

use crate::error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    File,
    Dir,
    Symlink,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirEntryInfo {
    pub(crate) name: String,
    pub(crate) kind: EntryKind,
    pub(crate) size: u64,
    pub(crate) mtime: String,
}

#[derive(Debug)]
pub(crate) struct WriteResult {
    pub(crate) size: u64,
    pub(crate) mtime: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileContent {
    pub(crate) content: String,
    pub(crate) size: u64,
    pub(crate) mtime: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirListing {
    pub(crate) entries: Vec<DirEntryInfo>,
    pub(crate) truncated: bool,
}

/// Rejects a relative path that is empty-hostile in ways no `Dir` walk
/// should even be asked to attempt: a NUL byte, an absolute path, or a `..`
/// component. This is a pure syntactic check on the string the caller
/// handed us, done before the workspace root is ever opened.
fn validate_rel(rel: &str) -> Result<(), RpcError> {
    if rel.as_bytes().contains(&0) {
        return Err(error::invalid_argument("relative path contains a NUL byte"));
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(error::invalid_argument(
            "relative path must not be absolute",
        ));
    }
    for component in rel_path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(error::invalid_argument(
                "relative path must not escape the workspace root",
            ));
        }
    }
    Ok(())
}

/// Canonicalizes `root` and opens it as an ambient capability. This is the
/// one unavoidable check-then-open step in the module (see the module
/// docs): everything opened relative to the returned `Dir` from here on is
/// walked component-by-component against that same descriptor, with no
/// further path-string re-resolution for this call to race against.
fn open_root_dir(root: &Path) -> Result<Dir, RpcError> {
    let root_canonical = std::fs::canonicalize(root)
        .map_err(|_| error::invalid_argument("workspace root does not exist"))?;
    if !root_canonical.is_dir() {
        return Err(error::invalid_argument("workspace root is not a directory"));
    }
    Dir::open_ambient_dir(&root_canonical, ambient_authority())
        .map_err(|e| error::io_error(e.to_string()))
}

const ESCAPE_MSG: &str = "workspace path must not follow a symlink outside the workspace root";

/// `cap_primitives` surfaces a walk that would leave the sandbox as
/// `io::ErrorKind::PermissionDenied` with this exact message. Matching on
/// both the kind and the message (rather than the kind alone) keeps a
/// genuine permission problem — e.g. a directory this process cannot search
/// — mapped to `io_error` instead of being misreported as a workspace
/// escape.
fn is_escape_attempt(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::PermissionDenied && e.to_string().contains("led outside")
}

/// Maps a `Dir`-relative lookup failure to our wire error codes: missing
/// path stays `not_found`, an escape attempt becomes `invalid_argument`,
/// anything else is a generic `io_error`.
fn map_lookup_error(e: std::io::Error, not_found_msg: &str) -> RpcError {
    if e.kind() == std::io::ErrorKind::NotFound {
        return error::not_found(not_found_msg);
    }
    if is_escape_attempt(&e) {
        return error::invalid_argument(ESCAPE_MSG);
    }
    error::io_error(e.to_string())
}

/// Maps a `Dir`-relative mutation failure (no "not found" case: a missing
/// parent is created, not reported) to our wire error codes.
fn map_dir_error(e: std::io::Error) -> RpcError {
    if is_escape_attempt(&e) {
        return error::invalid_argument(ESCAPE_MSG);
    }
    error::io_error(e.to_string())
}

fn entry_kind(meta: &cap_std::fs::Metadata) -> EntryKind {
    if meta.file_type().is_symlink() {
        EntryKind::Symlink
    } else if meta.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    }
}

pub(crate) fn list_dir(
    root: &Path,
    rel_path: &str,
    max_entries: usize,
    include_hidden: bool,
) -> Result<DirListing, RpcError> {
    validate_rel(rel_path)?;
    let root_dir = open_root_dir(root)?;

    if !rel_path.is_empty() {
        let meta = root_dir
            .metadata(rel_path)
            .map_err(|e| map_lookup_error(e, "directory not found"))?;
        if !meta.is_dir() {
            return Err(error::invalid_argument("path is not a directory"));
        }
    }

    let read_dir = if rel_path.is_empty() {
        root_dir.entries()
    } else {
        root_dir.read_dir(rel_path)
    }
    .map_err(|e| error::io_error(e.to_string()))?;

    // Stop as soon as `max_entries` results are collected instead of
    // reading the whole directory and truncating afterward, so an entry
    // past the cutoff (e.g. a non-UTF-8 name) can never make this call
    // fail. The returned page depends on the filesystem's own iteration
    // order when there are more entries than the cutoff, but is itself
    // sorted below, so its own order is always deterministic.
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in read_dir {
        if entries.len() == max_entries {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|e| error::io_error(e.to_string()))?;
        // Reject a non-UTF-8 name outright rather than lossily rewriting
        // it: a lossy rewrite can collide two distinct on-disk names onto
        // the same reported string.
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| error::invalid_argument("directory entry name is not valid UTF-8"))?;
        // Dotfile filter applies AFTER the cutoff above, never before: the
        // loop's bounded-cost and past-cutoff-never-fails properties stay
        // exactly as documented. A filtered dotfile therefore still consumes
        // one raw entry slot, so a directory holding more dotfiles than
        // `max_entries` can report a short truncated page; with the
        // production cap (1000) and the renderer's default of showing
        // dotfiles, that shape is never produced in practice.
        if !include_hidden && name.starts_with('.') {
            continue;
        }
        // `lstat`, not `stat`: reports the entry itself, never a symlink's
        // target, so listing never silently follows one.
        let meta = entry
            .metadata()
            .map_err(|e| error::io_error(e.to_string()))?;
        entries.push(DirEntryInfo {
            name,
            kind: entry_kind(&meta),
            size: meta.len(),
            mtime: meta
                .modified()
                .map(to_std_system_time)
                .map(format_rfc3339)
                .unwrap_or_default(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(DirListing { entries, truncated })
}

/// Opens `rel` (relative to `dir`) for reading and returns the handle
/// together with the metadata of that exact handle, having verified
/// `is_file` from it — never from a path-based stat taken beforehand. Both
/// `read_file` and `write_file`'s post-rename read-back need this identical
/// guarantee: a stat-then-open sequence has a window where a concurrent
/// actor swaps the target for something else (e.g. a FIFO) in between, and
/// a plain blocking open of a writer-less FIFO hangs indefinitely no matter
/// what an earlier stat said.
///
/// On unix this opens with `O_NONBLOCK` (via `libc::O_NONBLOCK` through the
/// public `cap_std::fs::OpenOptionsExt::custom_flags`): opening a
/// writer-less FIFO non-blocking succeeds immediately (an empty read)
/// instead of blocking, per POSIX, and has no effect on a regular file.
/// Non-unix targets have no non-blocking-open primitive available through
/// this crate's dependencies, so this is a plain blocking open there — a
/// narrower, documented guarantee: a FIFO swapped in on such a target can
/// still hang this call.
fn open_regular_file(
    dir: &Dir,
    rel: &Path,
    not_found_msg: &str,
) -> Result<(cap_std::fs::File, cap_std::fs::Metadata), RpcError> {
    let mut open_opts = OpenOptions::new();
    open_opts.read(true);
    #[cfg(unix)]
    open_opts.custom_flags(libc::O_NONBLOCK);
    let file = dir
        .open_with(rel, &open_opts)
        .map_err(|e| map_lookup_error(e, not_found_msg))?;
    // Same triage as the open above, not a bare `io_error`: a concurrent
    // unlink can still surface here as `NotFound` even though the open
    // above already succeeded (observed live under `--release` contention
    // in this module's own race tests), and an escape-shaped message
    // deserves the same `invalid_argument` mapping either way.
    let meta = file
        .metadata()
        .map_err(|e| map_lookup_error(e, not_found_msg))?;
    if !meta.is_file() {
        return Err(error::invalid_argument("path is not a regular file"));
    }
    Ok((file, meta))
}

pub(crate) fn read_file(root: &Path, rel: &str, max_bytes: u64) -> Result<FileContent, RpcError> {
    validate_rel(rel)?;
    let root_dir = open_root_dir(root)?;
    let (file, handle_meta) = open_regular_file(&root_dir, Path::new(rel), "file not found")?;

    // The byte cap is enforced by the bounded reader below, not by trusting
    // this stat's reported length: a file can grow between this check and
    // the read that follows, and a plain full read has no way to stop at a
    // limit.
    let mut bytes = Vec::new();
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| error::io_error(e.to_string()))?;
    if bytes.len() as u64 > max_bytes {
        return Err(error::invalid_argument("file exceeds max_bytes limit"));
    }
    let content =
        String::from_utf8(bytes).map_err(|_| error::invalid_argument("file is not valid UTF-8"))?;
    let size = content.len() as u64;
    let mtime = handle_meta
        .modified()
        .map(to_std_system_time)
        .map(format_rfc3339)
        .unwrap_or_default();
    Ok(FileContent {
        content,
        size,
        mtime,
    })
}

pub(crate) fn write_file(root: &Path, rel: &str, bytes: &[u8]) -> Result<WriteResult, RpcError> {
    validate_rel(rel)?;
    let root_dir = open_root_dir(root)?;

    let rel_path = Path::new(rel);
    let parent_rel = rel_path.parent().filter(|p| !p.as_os_str().is_empty());
    let file_name = rel_path
        .file_name()
        .ok_or_else(|| error::invalid_argument("path has no file name"))?;

    if let Some(parent_rel) = parent_rel {
        // Probe first rather than calling `create_dir_all` and swallowing
        // `AlreadyExists`: it falls back to its own `is_dir` probe on a
        // `mkdir` failure, which would misreport an escape attempt (an
        // existing name resolving outside the root) as that unhelpful I/O
        // error instead of `invalid_argument`.
        match root_dir.metadata(parent_rel) {
            Ok(meta) => {
                if !meta.is_dir() {
                    return Err(error::invalid_argument(
                        "workspace path's parent is not a directory",
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                root_dir.create_dir_all(parent_rel).map_err(map_dir_error)?;
            }
            Err(e) => return Err(map_dir_error(e)),
        }
    }

    // On unix, carry the destination's existing permission bits (e.g. an
    // executable script) across the atomic temp+rename swap below; a
    // brand-new file keeps the platform's default creation mode. Non-unix
    // targets have no equivalent POSIX mode bits to preserve, so this is a
    // no-op there and the current (default creation mode) behavior stands.
    #[cfg(unix)]
    let existing_mode = root_dir
        .symlink_metadata(rel)
        .ok()
        .filter(|m| m.file_type().is_file())
        .map(|m| m.permissions().mode());

    let tmp_name = format!(
        ".{}.tmp-{}",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    );
    let tmp_rel: PathBuf = match parent_rel {
        Some(parent_rel) => parent_rel.join(&tmp_name),
        None => PathBuf::from(&tmp_name),
    };

    // Exclusive create (`O_EXCL` semantics via `create_new`), not
    // create-and-truncate: the temp name embeds a fresh UUID and should
    // never already exist, so if it does — a planted file, a symlink, or
    // an (astronomically unlikely) UUID collision — this fails loudly
    // instead of silently truncating whatever is actually there.
    let mut create_opts = OpenOptions::new();
    create_opts.write(true).create_new(true);
    let mut tmp_file = match root_dir.open_with(&tmp_rel, &create_opts) {
        Ok(f) => f,
        Err(e) => return Err(map_dir_error(e)),
    };
    if let Err(e) = tmp_file.write_all(bytes) {
        drop(tmp_file);
        let _ = root_dir.remove_file(&tmp_rel);
        return Err(error::io_error(e.to_string()));
    }
    drop(tmp_file);

    #[cfg(unix)]
    if let Some(mode) = existing_mode
        && let Err(e) = root_dir.set_permissions(&tmp_rel, Permissions::from_mode(mode))
    {
        let _ = root_dir.remove_file(&tmp_rel);
        return Err(error::io_error(e.to_string()));
    }

    // Atomic swap, relative to the same open `Dir` on both sides: unlike
    // the old canonicalize-then-rename sequence, there is no separate
    // re-validation step to race here — if `rel_path`'s directory has been
    // swapped for something that walks outside the root since the write
    // above, this call itself fails closed with an escape attempt.
    if let Err(e) = root_dir.rename(&tmp_rel, &root_dir, rel_path) {
        let _ = root_dir.remove_file(&tmp_rel);
        return Err(map_dir_error(e));
    }

    // Bounded, type-checked read-back through the same `open_regular_file`
    // helper `read_file` uses: confirms the rename landed exactly the bytes
    // written, capped to `expected_len + 1` bytes rather than risking an
    // unbounded read against a file that grew after the rename, and that
    // what's now at `rel_path` is still a regular file — a concurrent actor
    // could have swapped it for a FIFO (or anything else) between the
    // rename above and this open.
    //
    // `size` is always `expected_len`, never the handle's reported `len()`
    // or a second, separately-raced stat: either would be free to disagree
    // with what the read-back actually verified.
    let expected_len = bytes.len() as u64;
    let (readback_file, handle_meta) = open_regular_file(&root_dir, rel_path, "file not found")?;
    let mut restored = Vec::new();
    readback_file
        .take(expected_len.saturating_add(1))
        .read_to_end(&mut restored)
        .map_err(|e| error::io_error(e.to_string()))?;
    if restored != bytes {
        return Err(error::internal_error(
            "write verification failed: content mismatch after rename",
        ));
    }
    Ok(WriteResult {
        size: expected_len,
        mtime: handle_meta
            .modified()
            .map(to_std_system_time)
            .map(format_rfc3339)
            .unwrap_or_default(),
    })
}

/// Ensures the parent chain of `rel_path` exists, creating missing
/// directories. Same probe-first shape as `write_file`'s own preamble (see
/// its comment): an existing non-directory parent is `invalid_argument`,
/// and an escape attempt surfaces as `invalid_argument` instead of a bare
/// I/O error. Deliberately not shared with `write_file`: that path is
/// frozen behavior and must not shift under this addition.
fn ensure_parent_dirs(root_dir: &Dir, rel_path: &Path) -> Result<(), RpcError> {
    let parent_rel = rel_path.parent().filter(|p| !p.as_os_str().is_empty());
    let Some(parent_rel) = parent_rel else {
        return Ok(());
    };
    match root_dir.metadata(parent_rel) {
        Ok(meta) => {
            if !meta.is_dir() {
                return Err(error::invalid_argument(
                    "workspace path's parent is not a directory",
                ));
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            root_dir.create_dir_all(parent_rel).map_err(map_dir_error)
        }
        Err(e) => Err(map_dir_error(e)),
    }
}

/// Creates one empty file or directory at `rel`, creating missing parents
/// like `write_file` does. An existing entry of ANY kind at `rel` (file,
/// directory, or symlink — `symlink_metadata` never follows the final
/// component, so a dangling symlink still counts) refuses with
/// `invalid_argument`: creation never overwrites and never succeeds as a
/// silent no-op. Containment and symlink-escape handling ride on the same
/// `Dir`-relative walk as every other mutation here.
pub(crate) fn create_path(root: &Path, rel: &str, kind: EntryKind) -> Result<(), RpcError> {
    if matches!(kind, EntryKind::Symlink) {
        return Err(error::invalid_argument(
            "a symlink cannot be created through this call",
        ));
    }
    validate_rel(rel)?;
    if rel.is_empty() {
        return Err(error::invalid_argument("path must not be empty"));
    }
    let root_dir = open_root_dir(root)?;
    let rel_path = Path::new(rel);
    rel_path
        .file_name()
        .ok_or_else(|| error::invalid_argument("path has no file name"))?;
    match root_dir.symlink_metadata(rel_path) {
        Ok(_) => {
            return Err(error::invalid_argument("workspace path already exists"));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(map_lookup_error(e, "workspace path not found")),
    }
    ensure_parent_dirs(&root_dir, rel_path)?;
    match kind {
        EntryKind::Dir => {
            // `create_dir`, not `create_dir_all`: the parents above already
            // exist, so `AlreadyExists` here is a lost creation race and
            // fails loudly as a collision rather than succeeding silently.
            root_dir.create_dir(rel_path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    error::invalid_argument("workspace path already exists")
                } else {
                    map_dir_error(e)
                }
            })
        }
        EntryKind::File => {
            // Exclusive create (`O_EXCL` semantics via `create_new`), the
            // same shape as `write_file`'s temp file: a planted entry that
            // won the race after the probe above fails here, never silently.
            let mut create_opts = OpenOptions::new();
            create_opts.write(true).create_new(true);
            root_dir
                .open_with(rel_path, &create_opts)
                .map(|_| ())
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::AlreadyExists {
                        error::invalid_argument("workspace path already exists")
                    } else {
                        map_dir_error(e)
                    }
                })
        }
        EntryKind::Symlink => Err(error::invalid_argument(
            "a symlink cannot be created through this call",
        )),
    }
}

/// Atomically renames `from` to `to` inside one workspace. The destination
/// is probed first so a collision reports `invalid_argument` instead of
/// silently overwriting; a concurrent creation winning the race between
/// that probe and the `rename` below can still overwrite (the OS offers no
/// `rename_noreplace` through this crate's dependencies — accepted, same
/// class as the module's documented sibling-swap limitation). Destination
/// parents are created like `write_file` does, and the `rename` itself runs
/// `Dir`-relative on both sides, so a swapped directory that would walk
/// outside the root fails closed.
pub(crate) fn rename_path(root: &Path, from: &str, to: &str) -> Result<(), RpcError> {
    validate_rel(from)?;
    validate_rel(to)?;
    if from.is_empty() || to.is_empty() {
        return Err(error::invalid_argument("path must not be empty"));
    }
    if from == to {
        return Err(error::invalid_argument(
            "source and destination paths are identical",
        ));
    }
    let root_dir = open_root_dir(root)?;
    let (from_path, to_path) = (Path::new(from), Path::new(to));
    // `symlink_metadata` never follows the final component: an existing
    // symlink destination is still a collision, never an overwrite-through.
    match root_dir.symlink_metadata(to_path) {
        Ok(_) => {
            return Err(error::invalid_argument("destination path already exists"));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(map_lookup_error(e, "destination path not found")),
    }
    ensure_parent_dirs(&root_dir, to_path)?;
    root_dir.rename(from_path, &root_dir, to_path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            error::not_found("source path not found")
        } else {
            map_dir_error(e)
        }
    })
}

/// Permanently deletes each path in order and returns the deleted paths.
/// Directories go with their contents (`remove_dir_all` through the open
/// `Dir`, so inner traversal stays sandboxed); a symlink deletes the LINK
/// itself (`remove_file`), never its target. There is deliberately no Trash
/// step: the daemon takes no OS-trash dependency, and the renderer owns the
/// source's confirmation copy before calling. Best-effort in order: entries
/// before a failure stay deleted and the returned error names the failing
/// path; callers needing atomicity must delete one entry per call.
pub(crate) fn delete_paths(root: &Path, paths: &[String]) -> Result<Vec<String>, RpcError> {
    if paths.is_empty() {
        return Err(error::invalid_argument("no workspace paths to delete"));
    }
    if paths.len() > drogon_protocol::workspace_files::MAX_DELETE_PATHS {
        return Err(error::invalid_argument(
            "too many workspace paths to delete",
        ));
    }
    let root_dir = open_root_dir(root)?;
    let mut deleted = Vec::with_capacity(paths.len());
    for rel in paths {
        validate_rel(rel)?;
        if rel.is_empty() {
            return Err(error::invalid_argument("path must not be empty"));
        }
        let rel_path = Path::new(rel);
        let meta = root_dir
            .symlink_metadata(rel_path)
            .map_err(|e| map_lookup_error(e, "workspace path not found"))?;
        if meta.file_type().is_dir() {
            root_dir
                .remove_dir_all(rel_path)
                .map_err(|e| map_lookup_error(e, "workspace path not found"))?;
        } else {
            root_dir
                .remove_file(rel_path)
                .map_err(|e| map_lookup_error(e, "workspace path not found"))?;
        }
        deleted.push(rel.clone());
    }
    Ok(deleted)
}

/// Bounded result of [`search_files`]: workspace-relative `/`-separated
/// paths in deterministic (sorted, breadth-first) order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchListing {
    pub(crate) files: Vec<String>,
    pub(crate) truncated: bool,
}

/// Hidden-dir blocklist ported from the reference quick-open filter
/// (`src/shared/quick-open-filter.ts` `HIDDEN_DIR_BLOCKLIST` plus its
/// `node_modules` prune): tool-generated caches/state, never hand-edited
/// user dirs. A blocklist (not an allowlist) keeps novel dotfiles
/// discoverable, so `.config` and friends stay searchable.
const SEARCH_BLOCKED_DIRS: &[&str] = &[
    ".git",
    ".next",
    ".nuxt",
    ".cache",
    ".stably",
    ".vscode",
    ".idea",
    ".yarn",
    ".pnpm-store",
    ".terraform",
    ".docker",
    ".husky",
    ".npm",
    ".npm-global",
    ".gvfs",
    "node_modules",
];

/// Blocked `/`-separated relative path prefixes (the source's
/// `.local/share` runtime-subtree rule).
const SEARCH_BLOCKED_PATHS: &[&str] = &[".local/share"];

/// Bounds on one search scan so a huge worktree cannot hold the call open:
/// past either cap the scan stops and reports `truncated`.
const SEARCH_MAX_DIRS: usize = 4000;
const SEARCH_MAX_SCANNED_ENTRIES: usize = 100_000;

/// True when a `/`-separated root-relative path crosses a blocked segment
/// or prefix. Runs per candidate, so it stays allocation-free on hits.
fn search_path_blocked(rel: &str) -> bool {
    for blocked in SEARCH_BLOCKED_PATHS {
        if rel == *blocked || rel.starts_with(&format!("{blocked}/")) {
            return true;
        }
    }
    rel.split('/')
        .any(|segment| SEARCH_BLOCKED_DIRS.contains(&segment))
}

/// Case-insensitive subsequence match: every query char appears in the
/// candidate in order. Empty query matches everything. The renderer owns
/// fuzzy ranking; the daemon only needs the same recall boundary.
fn search_query_matches(query_lower: &str, candidate: &str) -> bool {
    if query_lower.is_empty() {
        return true;
    }
    let candidate_lower = candidate.to_lowercase();
    let mut rest = candidate_lower.as_str();
    for q in query_lower.chars() {
        match rest.find(q) {
            Some(at) => rest = &rest[at + q.len_utf8()..],
            None => return false,
        }
    }
    true
}

struct SearchCollector {
    query_lower: String,
    limit: usize,
    files: Vec<String>,
    extra_matches: usize,
    incomplete: bool,
}

impl SearchCollector {
    fn consider(&mut self, rel: &str) {
        if !search_query_matches(&self.query_lower, rel) {
            return;
        }
        if self.files.len() < self.limit {
            self.files.push(rel.to_string());
        } else {
            self.extra_matches += 1;
        }
    }

    fn listing(self) -> SearchListing {
        SearchListing {
            files: self.files,
            truncated: self.extra_matches > 0 || self.incomplete,
        }
    }
}

/// True when `root` is itself a git repo root or a linked worktree (a
/// `.git` dir or, for worktrees, a `.git` file). Checked without following
/// the final component, so a planted `.git` symlink never reads as a repo.
fn is_git_worktree_root(root: &Path) -> bool {
    std::fs::symlink_metadata(root.join(".git"))
        .map(|meta| {
            let kind = meta.file_type();
            kind.is_dir() || kind.is_file()
        })
        .unwrap_or(false)
}

/// Lists candidates via `git ls-files --cached --others --exclude-standard`
/// (`-z` for newline-safe paths): tracked plus untracked-but-not-ignored
/// files, honoring `.gitignore`. Returns false when git is unavailable or
/// the directory is not actually a repo, so the caller falls back to the
/// plain walk below. Never fails the search outright.
fn try_search_via_git_ls_files(root: &Path, collector: &mut SearchCollector) -> bool {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ])
        .output();
    let output = match output {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };
    let mut scanned = 0usize;
    for chunk in output.stdout.split(|byte| *byte == 0) {
        if chunk.is_empty() {
            continue;
        }
        scanned += 1;
        if scanned > SEARCH_MAX_SCANNED_ENTRIES {
            collector.incomplete = true;
            break;
        }
        // Lossy is deliberate here: git paths that are not UTF-8 cannot
        // round-trip the JSON wire anyway (list_dir refuses them outright).
        let path = String::from_utf8_lossy(chunk).replace('\\', "/");
        if path.is_empty() || search_path_blocked(&path) {
            continue;
        }
        collector.consider(&path);
    }
    true
}

/// Plain breadth-first walk over the `cap_std` root handle for non-git
/// workspaces, applying the same blocklist the git path gets from
/// `--exclude-standard` plus [`search_path_blocked`]. Descends only into
/// true directories (`file_type` never follows the final component), so a
/// symlinked dir is listed as one candidate, never traversed out of root.
/// Siblings sort by name, so output order is deterministic.
fn search_via_walk(root_dir: &Dir, collector: &mut SearchCollector) {
    let mut queue: Vec<String> = vec![String::new()];
    let mut cursor = 0usize;
    let mut dirs_visited = 0usize;
    let mut scanned = 0usize;
    while cursor < queue.len() {
        if dirs_visited >= SEARCH_MAX_DIRS {
            collector.incomplete = true;
            break;
        }
        dirs_visited += 1;
        let rel = queue[cursor].clone();
        cursor += 1;
        let read_dir = if rel.is_empty() {
            root_dir.entries()
        } else {
            root_dir.read_dir(rel.as_str())
        };
        let read_dir = match read_dir {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        let mut names: Vec<(String, bool)> = Vec::new();
        for entry in read_dir {
            scanned += 1;
            if scanned > SEARCH_MAX_SCANNED_ENTRIES {
                collector.incomplete = true;
                break;
            }
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };
            let name = match entry.file_name().into_string() {
                Ok(name) => name,
                Err(_) => continue,
            };
            let is_dir = match entry.file_type() {
                Ok(kind) => kind.is_dir(),
                Err(_) => continue,
            };
            names.push((name, is_dir));
        }
        if collector.incomplete {
            break;
        }
        names.sort_by(|a, b| a.0.cmp(&b.0));
        for (name, is_dir) in names {
            let child = if rel.is_empty() {
                name
            } else {
                format!("{rel}/{name}")
            };
            if search_path_blocked(&child) {
                continue;
            }
            if is_dir {
                queue.push(child);
            } else {
                collector.consider(&child);
            }
        }
    }
}

/// Bounded workspace-relative path search for quick open. A git repo root
/// (or linked worktree) lists via `git ls-files` honoring `.gitignore`;
/// anything else walks with the source's ignore list. `query` is a
/// case-insensitive subsequence filter (empty matches all); at most
/// `limit` paths return with `truncated` set when more matched or the
/// scan hit its internal caps.
pub(crate) fn search_files(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<SearchListing, RpcError> {
    if limit == 0 {
        return Err(error::invalid_argument(
            "file search limit must be at least 1",
        ));
    }
    let normalized = query.trim();
    if normalized.contains('\0') {
        return Err(error::invalid_argument(
            "file search query contains a NUL byte",
        ));
    }
    if normalized.len() > drogon_protocol::workspace_files::MAX_FILE_SEARCH_QUERY_BYTES {
        return Err(error::invalid_argument("file search query is too large"));
    }
    let mut collector = SearchCollector {
        query_lower: normalized.to_lowercase(),
        limit,
        files: Vec::new(),
        extra_matches: 0,
        incomplete: false,
    };
    if is_git_worktree_root(root) && try_search_via_git_ls_files(root, &mut collector) {
        return Ok(collector.listing());
    }
    let root_dir = open_root_dir(root)?;
    search_via_walk(&root_dir, &mut collector);
    Ok(collector.listing())
}

/// `cap_std`'s `Metadata::modified` returns its own `cap_std::time::SystemTime`
/// (it has no `now`/`elapsed`, only conversion to/from `std`, to keep the
/// capability model from smuggling in ambient clock access) rather than
/// `std::time::SystemTime`, so this converts it via its duration since the
/// Unix epoch for `format_rfc3339` below.
fn to_std_system_time(t: cap_std::time::SystemTime) -> SystemTime {
    let dur = t
        .duration_since(cap_std::time::SystemClock::UNIX_EPOCH)
        .unwrap_or_default();
    UNIX_EPOCH + dur
}

// TODO(WIRING): keep-until-shared-helper — format_rfc3339/civil_from_days
// format a filesystem-metadata timestamp, not wall-clock now, so they must
// NOT be replaced with crate::now_rfc3339. ROOT factors a proper shared
// metadata-time formatter at wiring time; do not restructure anything else
// about this module for that.
fn format_rfc3339(time: SystemTime) -> String {
    let dur = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = dur.as_secs();
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days as i64);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}

/// Howard Hinnant's civil-from-days algorithm (public domain). Duplicated
/// from `drogon_core::now_rfc3339`'s private helper because this module is
/// compiled standalone by its test (via `#[path]`, ahead of `lib.rs` wiring)
/// and cannot reach that crate-root-private function.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
