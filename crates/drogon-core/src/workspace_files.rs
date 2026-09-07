//! Workspace-scoped file explorer/editor primitives. Ahead of the additive
//! RPC methods `protocol-v1.md` reserves for file read/write, this module
//! gives `list_dir`/`read_file`/`write_file` a caller-supplied workspace-root
//! boundary: every relative path is checked for traversal (`..`, absolute,
//! NUL) and, component by component, for a symlink that would resolve
//! outside that root. A symlink that stays inside the root may be followed;
//! one that escapes is refused rather than silently traversed.

use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Validates `rel` against `root` and resolves it to an absolute path that
/// is guaranteed not to escape `root` through `..`, an absolute component,
/// or a symlink whose real target lies outside `root`. The final path
/// element need not exist (callers writing a new file rely on that).
fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, RpcError> {
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

    let root_canonical = std::fs::canonicalize(root)
        .map_err(|_| error::invalid_argument("workspace root does not exist"))?;
    if !root_canonical.is_dir() {
        return Err(error::invalid_argument("workspace root is not a directory"));
    }

    let mut resolved = root_canonical.clone();
    for component in rel_path.components() {
        let Component::Normal(part) = component else {
            continue;
        };
        let candidate = resolved.join(part);
        match std::fs::symlink_metadata(&candidate) {
            Ok(meta) if meta.file_type().is_symlink() => {
                let target = std::fs::canonicalize(&candidate).map_err(|_| {
                    error::invalid_argument("workspace path contains a broken symlink")
                })?;
                if !target.starts_with(&root_canonical) {
                    return Err(error::invalid_argument(
                        "workspace path must not follow a symlink outside the workspace root",
                    ));
                }
                resolved = target;
            }
            _ => resolved = candidate,
        }
    }
    Ok(resolved)
}

fn entry_kind(meta: &std::fs::Metadata) -> EntryKind {
    if meta.file_type().is_symlink() {
        EntryKind::Symlink
    } else if meta.is_dir() {
        EntryKind::Dir
    } else {
        EntryKind::File
    }
}

pub(crate) fn list_dir(root: &Path, rel_path: &str) -> Result<Vec<DirEntryInfo>, RpcError> {
    let dir_path = resolve_in_root(root, rel_path)?;
    let dir_meta =
        std::fs::metadata(&dir_path).map_err(|_| error::not_found("directory not found"))?;
    if !dir_meta.is_dir() {
        return Err(error::invalid_argument("path is not a directory"));
    }

    let read_dir = std::fs::read_dir(&dir_path).map_err(|e| error::io_error(e.to_string()))?;
    let mut entries = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|e| error::io_error(e.to_string()))?;
        // `DirEntry::metadata` is an `lstat`: it reports the entry itself,
        // never the target of a symlink, so listing never silently follows.
        let meta = entry.metadata().map_err(|e| error::io_error(e.to_string()))?;
        entries.push(DirEntryInfo {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind: entry_kind(&meta),
            size: meta.len(),
            mtime: meta.modified().map(format_rfc3339).unwrap_or_default(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

pub(crate) fn read_file(root: &Path, rel: &str, max_bytes: u64) -> Result<String, RpcError> {
    let file_path = resolve_in_root(root, rel)?;
    let meta = std::fs::metadata(&file_path).map_err(|_| error::not_found("file not found"))?;
    if meta.is_dir() {
        return Err(error::invalid_argument("path is a directory"));
    }
    if meta.len() > max_bytes {
        return Err(error::invalid_argument("file exceeds max_bytes limit"));
    }
    let bytes = std::fs::read(&file_path).map_err(|e| error::io_error(e.to_string()))?;
    String::from_utf8(bytes).map_err(|_| error::invalid_argument("file is not valid UTF-8"))
}

pub(crate) fn write_file(root: &Path, rel: &str, bytes: &[u8]) -> Result<WriteResult, RpcError> {
    let file_path = resolve_in_root(root, rel)?;
    let parent = file_path
        .parent()
        .ok_or_else(|| error::invalid_argument("path has no parent directory"))?;
    std::fs::create_dir_all(parent).map_err(|e| error::io_error(e.to_string()))?;

    let file_name = file_path
        .file_name()
        .ok_or_else(|| error::invalid_argument("path has no file name"))?;
    let tmp_path = parent.join(format!(
        ".{}.tmp-{}",
        file_name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));

    let write_result = std::fs::write(&tmp_path, bytes);
    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error::io_error(e.to_string()));
    }
    if let Err(e) = std::fs::rename(&tmp_path, &file_path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(error::io_error(e.to_string()));
    }

    // Read-back restore verification: confirm the rename landed exactly the
    // bytes we wrote before reporting durable success.
    let restored = std::fs::read(&file_path).map_err(|e| error::io_error(e.to_string()))?;
    if restored != bytes {
        return Err(error::internal_error(
            "write verification failed: content mismatch after rename",
        ));
    }
    let meta = std::fs::metadata(&file_path).map_err(|e| error::io_error(e.to_string()))?;
    Ok(WriteResult {
        size: meta.len(),
        mtime: meta.modified().map(format_rfc3339).unwrap_or_default(),
    })
}

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
