//! Workspace-scoped file explorer/editor primitives. Ahead of the additive
//! RPC methods `protocol-v1.md` reserves for file read/write, this module
//! gives `list_dir`/`read_file`/`write_file` a caller-supplied workspace-root
//! boundary: every relative path is checked for traversal (`..`, absolute,
//! NUL) up front, and the actual filesystem work below that check is done
//! entirely through a single `cap_std::fs::Dir` handle opened once on the
//! workspace root.
//!
//! `Dir` resolves every path component against its own open file descriptor
//! (openat-style), one component at a time, rather than building a string
//! and re-resolving it against the live filesystem the way `std::fs` +
//! `canonicalize` does. That closes the classic TOCTOU window this module
//! used to document: a concurrent actor can no longer swap a directory
//! component for a symlink between "we checked this path is safe" and "we
//! acted on it", because there is no separate check step for it to win a
//! race against — each `Dir` method performs the walk-and-act as one
//! sequence of syscalls relative to the held descriptor. A `..` or an
//! absolute component encountered while walking a path, or while following a
//! symlink's target, above the open root is refused outright (`Dir` has no
//! parent-descriptor to escape into).
//!
//! What this does NOT close: the single ambient `Dir::open_ambient_dir` call
//! below that turns the caller-supplied `root` path into a descriptor is
//! still one check-then-open step (canonicalize, then open by that path);
//! and identity is only pinned from that point down — if a *sibling*
//! directory that is itself fully contained gets swapped for a different
//! fully-contained directory between two separate calls into this module
//! (e.g. between `write_file`'s write and its later read-back), both
//! resolve successfully and neither is a violation `Dir` can detect, because
//! containment, not identity-across-calls, is the guarantee it makes.
//!
//! Symlink policy: a symlink whose target is a *relative* path that stays
//! within the root is followed by `cap_std`'s own resolver — it holds
//! directory descriptors down through the chain and refuses any `..` that
//! would go above the open root. A symlink whose target is an *absolute*
//! path is REFUSED UNCONDITIONALLY, including in the case where that target
//! would itself resolve inside `root`. This is explicit UNMET behavior, not
//! a considered security boundary: `cap_std`'s sandbox has no notion of the
//! root's real absolute location to compare an absolute target against. A
//! prior attempt at closing this gap (locating the redirect by walking
//! single components and retrying through the same open handle) was
//! implemented and then reverted by root ruling; do not reintroduce it, and
//! any future attempt must not fall back to a string-canonicalize-and-
//! compare check-then-act step to do so.
//!
//! `read_file` does not trust a path-based stat taken before opening: a
//! stat-then-open sequence has a window where the target can be swapped for
//! something else (e.g. a FIFO) in between, and a plain (blocking) open of a
//! FIFO with no writer attached hangs indefinitely regardless of what an
//! earlier stat said. It opens non-blocking instead — see
//! `read_file`'s own doc comment for how, given this crate has no direct
//! dependency that names `O_NONBLOCK`'s value — and re-checks the type from
//! the metadata of the handle it actually got, not from any earlier stat.
//!
//! `list_dir` stops enumerating as soon as it has collected `max_entries`
//! results rather than reading the whole directory and truncating
//! afterward, so its cost is bounded by `max_entries`, not by how large the
//! directory actually is (or by entries in it that would otherwise fail to
//! process, e.g. a non-UTF-8 name past the cutoff this call was never going
//! to return anyway).
//!
//! `write_file`'s temp file is created with `create_new` (`O_EXCL`
//! semantics): its name embeds a fresh UUID and should never already exist,
//! so if it does — a planted file, a symlink, or an (astronomically
//! unlikely) UUID collision — creation fails instead of silently truncating
//! whatever was already there. Its post-rename read-back is bounded to the
//! expected length plus one byte, the same technique `read_file` uses to
//! cap a read, rather than reading the whole (potentially since-grown) file
//! into memory just to verify it.
//!
//! `revalidate_containment` is kept as a `std`-path-based, best-effort
//! diagnostic (its own two direct unit tests still exercise it), but is no
//! longer called from `write_file`'s success path: re-checking a path with
//! `canonicalize` after a `Dir`-relative write is a check-then-act step of
//! exactly the kind this module now avoids, and the `Dir`-relative rename it
//! used to guard already fails closed (an `escape_attempt`, mapped to
//! `invalid_argument`) if its target can't be walked inside the root.

use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions, Permissions, PermissionsExt};
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
    e.kind() == std::io::ErrorKind::PermissionDenied
        && e.to_string().contains("led outside")
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

/// Re-canonicalizes `parent` and confirms it still lies under `root`. Kept
/// as a `std`-path-based, best-effort diagnostic (see the module docs for
/// why the write path no longer gates success on this): it is itself a
/// check-then-act step, not a lock, and is superseded for correctness by
/// the `Dir`-relative rename in `write_file`, which fails closed on its own.
pub(crate) fn revalidate_containment(root: &Path, parent: &Path) -> Result<(), RpcError> {
    let root_canonical = std::fs::canonicalize(root)
        .map_err(|_| error::invalid_argument("workspace root does not exist"))?;
    let parent_canonical = std::fs::canonicalize(parent)
        .map_err(|_| error::invalid_argument("workspace path no longer resolves"))?;
    if !parent_canonical.starts_with(&root_canonical) {
        return Err(error::invalid_argument(
            "workspace path escaped the workspace root after resolution",
        ));
    }
    Ok(())
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

    // Bounded enumeration: stop as soon as `max_entries` results have been
    // collected instead of reading the whole directory and truncating
    // afterward. This bounds both the work done and the memory used by
    // `max_entries`, not by the directory's real size, and means an entry
    // this call was never going to return anyway (e.g. a non-UTF-8 name
    // past the cutoff) can never make it fail. Which entries land in the
    // returned page therefore depends on the filesystem's own (unspecified)
    // iteration order when there are more than `max_entries` of them; the
    // page itself is still sorted below so its own order is deterministic.
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in read_dir {
        if entries.len() == max_entries {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|e| error::io_error(e.to_string()))?;
        // Reject a non-UTF-8 entry name outright rather than lossily
        // rewriting it: a lossy rewrite can silently collide two distinct
        // on-disk names onto the same reported string, which is exactly
        // the kind of ambiguity a caller acting on this listing (e.g. to
        // build a further `rel` path) must never be handed.
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| error::invalid_argument("directory entry name is not valid UTF-8"))?;
        // `DirEntry::metadata` is an `lstat`: it reports the entry itself,
        // never the target of a symlink, so listing never silently follows.
        let meta = entry.metadata().map_err(|e| error::io_error(e.to_string()))?;
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

pub(crate) fn read_file(root: &Path, rel: &str, max_bytes: u64) -> Result<FileContent, RpcError> {
    validate_rel(rel)?;
    let root_dir = open_root_dir(root)?;

    // Open non-blocking and validate the type from the metadata of the
    // handle actually opened — never from a path-based stat taken
    // beforehand. A stat-then-open sequence has a window where a
    // concurrent actor swaps the target for something else between the
    // two, and a plain (blocking) open of a FIFO with no writer attached
    // hangs indefinitely no matter what an earlier stat said.
    //
    // Setting `O_NONBLOCK` needs `_cap_fs_ext_nonblock`: the public,
    // non-hidden `cap_std::fs::OpenOptionsExt` (unix) only exposes a raw
    // `custom_flags(i32)` knob, and this crate has no direct dependency
    // (`libc`/`rustix`) that names `O_NONBLOCK`'s platform value to pass
    // through it. `_cap_fs_ext_nonblock` is `#[doc(hidden)]` — it exists so
    // the `cap-fs-ext` crate can expose a friendly `nonblock()` extension —
    // but it is a genuinely public method on the exact, pinned (`=4.0.3`)
    // `cap_std::fs::OpenOptions` this crate depends on, and is what
    // actually closes the swap-to-FIFO race a pre-open stat cannot: opening
    // a FIFO non-blocking with no writer present succeeds immediately
    // (returning an empty read) instead of blocking, per POSIX. Opening a
    // regular file this way is unaffected.
    let mut open_opts = OpenOptions::new();
    open_opts.read(true);
    open_opts._cap_fs_ext_nonblock(true);
    let file = root_dir
        .open_with(rel, &open_opts)
        .map_err(|e| map_lookup_error(e, "file not found"))?;

    // The authoritative type check, on the handle we actually got.
    let handle_meta = file
        .metadata()
        .map_err(|e| error::io_error(e.to_string()))?;
    if !handle_meta.is_file() {
        return Err(error::invalid_argument("path is not a regular file"));
    }

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
    let content = String::from_utf8(bytes)
        .map_err(|_| error::invalid_argument("file is not valid UTF-8"))?;
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
        // Check-then-create, not create-then-swallow-EEXIST-and-recheck:
        // `Dir::create_dir_all` treats a `mkdir` failure on an
        // already-occupied name as "maybe it's already a directory" and
        // falls back to its own `is_dir` probe, which would swallow an
        // escape attempt here (an existing name that resolves outside the
        // root is neither creatable nor a directory) as the original,
        // unhelpful `AlreadyExists` I/O error. Probing first keeps the
        // escape mapped to `invalid_argument` instead.
        match root_dir.metadata(parent_rel) {
            Ok(meta) => {
                if !meta.is_dir() {
                    return Err(error::invalid_argument(
                        "workspace path's parent is not a directory",
                    ));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                root_dir
                    .create_dir_all(parent_rel)
                    .map_err(map_dir_error)?;
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

    // Bounded read-back: confirm the rename landed exactly the bytes we
    // wrote without reading more than `expected_len + 1` bytes into memory
    // to do it — the same technique `read_file` uses to cap a read. An
    // unbounded read-back here would let a file that grew unexpectedly
    // after the rename (e.g. another writer racing in) balloon this call's
    // memory use in proportion to however large it grew, rather than to
    // what this call actually expected to find.
    //
    // `handle_meta` is fetched right after opening, before the read: its
    // `mtime` is only informational, but its `len()` is deliberately never
    // used for the reported `size` below. A separate stat taken *after*
    // this read-back would race against exactly the same kind of
    // concurrent growth the bounded read-back exists to be robust against
    // — a writer appending between the read-back succeeding and that stat
    // running would report a `size` that never matches what was actually
    // verified. `expected_len` is what the bounded, content-matching
    // read-back just proved the file held, and is what gets reported.
    let expected_len = bytes.len() as u64;
    let readback_file = root_dir
        .open(rel_path)
        .map_err(|e| error::io_error(e.to_string()))?;
    let handle_meta = readback_file
        .metadata()
        .map_err(|e| error::io_error(e.to_string()))?;
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
