//! Behavioral tests for the workspace-scoped file explorer primitives.
//! Compiles `src/workspace_files.rs` directly (no `lib.rs` change needed yet;
//! this module is not wired into the RPC surface in this change) and reuses
//! the real `error.rs` constructors the same way, so error codes stay exact
//! with `docs/migration/protocol-v1.md`'s frozen set.

// Most of error.rs's constructors are unused by this test crate but ARE
// used by the real drogon-core lib build; don't let clippy flag them dead.
#[allow(dead_code)]
#[path = "../src/error.rs"]
mod error;
#[path = "../src/workspace_files.rs"]
mod workspace_files;

use std::fs;

use tempfile::tempdir;
use workspace_files::{EntryKind, list_dir, read_file, write_file};

const MANY: usize = 1000;

fn make_root() -> tempfile::TempDir {
    tempdir().unwrap()
}

// --- path-traversal rejection -------------------------------------------

#[test]
fn list_dir_rejects_parent_dir_traversal() {
    let root = make_root();
    let err = list_dir(root.path(), "../escape", MANY).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn read_file_rejects_absolute_path() {
    let root = make_root();
    let err = read_file(root.path(), "/etc/passwd", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn write_file_rejects_nul_byte_in_path() {
    let root = make_root();
    let err = write_file(root.path(), "bad\0name.txt", b"x").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn read_file_rejects_traversal_hidden_in_a_middle_component() {
    let root = make_root();
    fs::create_dir(root.path().join("sub")).unwrap();
    let err = read_file(root.path(), "sub/../../outside.txt", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- symlink policy -------------------------------------------------------

#[test]
#[cfg(unix)]
fn list_dir_reports_symlink_entries_distinctly_without_following() {
    use std::os::unix::fs::symlink;

    let root = make_root();
    fs::write(root.path().join("real.txt"), b"hello").unwrap();
    fs::create_dir(root.path().join("realdir")).unwrap();
    symlink(root.path().join("realdir"), root.path().join("linked-dir")).unwrap();

    let listing = list_dir(root.path(), "", MANY).unwrap();
    assert!(!listing.truncated);
    let names_kinds: Vec<(String, EntryKind)> = listing
        .entries
        .iter()
        .map(|e| (e.name.clone(), e.kind))
        .collect();

    assert_eq!(
        names_kinds,
        vec![
            ("linked-dir".to_string(), EntryKind::Symlink),
            ("real.txt".to_string(), EntryKind::File),
            ("realdir".to_string(), EntryKind::Dir),
        ]
    );
}

#[test]
#[cfg(unix)]
fn resolving_into_a_symlink_that_escapes_root_is_rejected() {
    use std::os::unix::fs::symlink;

    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), b"top secret").unwrap();

    let root = make_root();
    symlink(outside.path(), root.path().join("escape")).unwrap();

    let err = read_file(root.path(), "escape/secret.txt", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    let err = list_dir(root.path(), "escape", MANY).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
#[cfg(unix)]
fn resolving_into_a_symlink_that_stays_within_root_is_allowed() {
    use std::os::unix::fs::symlink;

    let root = make_root();
    fs::create_dir(root.path().join("realdir")).unwrap();
    fs::write(root.path().join("realdir/inner.txt"), b"inner").unwrap();
    symlink(root.path().join("realdir"), root.path().join("alias")).unwrap();

    let content = read_file(root.path(), "alias/inner.txt", 1024).unwrap();
    assert_eq!(content, "inner");
}

// --- list_dir sorting / metadata -----------------------------------------

#[test]
fn list_dir_sorts_entries_and_reports_kind_and_size() {
    let root = make_root();
    fs::write(root.path().join("b.txt"), b"12345").unwrap();
    fs::create_dir(root.path().join("a-dir")).unwrap();

    let listing = list_dir(root.path(), "", MANY).unwrap();
    assert!(!listing.truncated);
    let entries = listing.entries;
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].name, "a-dir");
    assert_eq!(entries[0].kind, EntryKind::Dir);
    assert_eq!(entries[1].name, "b.txt");
    assert_eq!(entries[1].kind, EntryKind::File);
    assert_eq!(entries[1].size, 5);
    assert!(!entries[1].mtime.is_empty());
}

#[test]
fn list_dir_not_found_maps_to_not_found_error() {
    let root = make_root();
    let err = list_dir(root.path(), "missing", MANY).unwrap_err();
    assert_eq!(err.code, "not_found");
}

// --- list_dir bounded/truncation -------------------------------------------

#[test]
fn list_dir_truncates_and_reports_the_flag_when_max_entries_exceeded() {
    let root = make_root();
    for i in 0..5 {
        fs::write(root.path().join(format!("f{i}.txt")), b"x").unwrap();
    }

    let listing = list_dir(root.path(), "", 3).unwrap();
    assert!(listing.truncated);
    assert_eq!(listing.entries.len(), 3);
    let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, vec!["f0.txt", "f1.txt", "f2.txt"]);
}

#[test]
fn list_dir_reports_untruncated_when_entries_fit_within_max_entries() {
    let root = make_root();
    fs::write(root.path().join("a.txt"), b"x").unwrap();
    fs::write(root.path().join("b.txt"), b"x").unwrap();

    let listing = list_dir(root.path(), "", 2).unwrap();
    assert!(!listing.truncated);
    assert_eq!(listing.entries.len(), 2);
}

#[test]
fn list_dir_exact_limit_boundary_is_not_truncated() {
    let root = make_root();
    fs::write(root.path().join("a.txt"), b"x").unwrap();
    fs::write(root.path().join("b.txt"), b"x").unwrap();
    fs::write(root.path().join("c.txt"), b"x").unwrap();

    let listing = list_dir(root.path(), "", 3).unwrap();
    assert!(!listing.truncated);
    assert_eq!(listing.entries.len(), 3);

    let listing = list_dir(root.path(), "", 2).unwrap();
    assert!(listing.truncated);
    assert_eq!(listing.entries.len(), 2);
}

// --- read_file error mapping ----------------------------------------------

#[test]
fn read_file_returns_not_found_for_missing_file() {
    let root = make_root();
    let err = read_file(root.path(), "nope.txt", 1024).unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn read_file_returns_invalid_argument_for_a_directory() {
    let root = make_root();
    fs::create_dir(root.path().join("adir")).unwrap();
    let err = read_file(root.path(), "adir", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn read_file_returns_invalid_argument_when_too_large() {
    let root = make_root();
    fs::write(root.path().join("big.txt"), b"0123456789").unwrap();
    let err = read_file(root.path(), "big.txt", 4).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn read_file_returns_invalid_argument_for_non_utf8_content() {
    let root = make_root();
    fs::write(root.path().join("bin.dat"), [0xff, 0xfe, 0x00, 0x01]).unwrap();
    let err = read_file(root.path(), "bin.dat", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
fn read_file_returns_content_on_success() {
    let root = make_root();
    fs::write(root.path().join("ok.txt"), "hello world").unwrap();
    let content = read_file(root.path(), "ok.txt", 1024).unwrap();
    assert_eq!(content, "hello world");
}

// --- read_file bound enforcement -------------------------------------------

#[test]
fn read_file_allows_content_exactly_at_the_max_bytes_boundary() {
    let root = make_root();
    fs::write(root.path().join("exact.txt"), b"0123456789").unwrap();
    let content = read_file(root.path(), "exact.txt", 10).unwrap();
    assert_eq!(content, "0123456789");
}

#[test]
fn read_file_rejects_content_one_byte_over_the_max_bytes_boundary() {
    let root = make_root();
    fs::write(root.path().join("over.txt"), b"01234567890").unwrap();
    let err = read_file(root.path(), "over.txt", 10).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
#[cfg(unix)]
fn read_file_rejects_a_fifo_special_file_instead_of_blocking() {
    let root = make_root();
    let fifo_path = root.path().join("pipe");
    let status = std::process::Command::new("mkfifo")
        .arg(&fifo_path)
        .status()
        .expect("failed to invoke mkfifo");
    assert!(status.success(), "mkfifo command failed");

    let err = read_file(root.path(), "pipe", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
#[cfg(unix)]
fn read_file_never_returns_content_beyond_max_bytes_while_the_file_grows_concurrently() {
    use std::io::Write as _;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    let root = make_root();
    let path = root.path().join("growing.log");
    fs::write(&path, b"start").unwrap();
    let max_bytes = 20u64;

    let writer_path = path.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_writer = stop.clone();
    let writer = std::thread::spawn(move || {
        while !stop_writer.load(Ordering::Relaxed) {
            if let Ok(mut f) = fs::OpenOptions::new().append(true).open(&writer_path) {
                let _ = f.write_all(b"x");
            }
        }
    });

    // A growing file must never make it back out with more than max_bytes
    // of content, and must never silently truncate: every outcome across
    // many overlapping attempts is either a bound-respecting Ok or a clean
    // invalid_argument rejection.
    for _ in 0..500 {
        match read_file(root.path(), "growing.log", max_bytes) {
            Ok(content) => assert!(content.len() as u64 <= max_bytes),
            Err(err) => assert_eq!(err.code, "invalid_argument"),
        }
    }

    stop.store(true, Ordering::Relaxed);
    writer.join().unwrap();
}

// --- write_file atomicity / verification ----------------------------------

#[test]
fn write_file_creates_parent_dirs_only_inside_root_and_verifies_readback() {
    let root = make_root();
    let result = write_file(root.path(), "nested/dir/out.txt", b"payload").unwrap();
    assert_eq!(result.size, 7);
    assert!(!result.mtime.is_empty());

    let on_disk = fs::read(root.path().join("nested/dir/out.txt")).unwrap();
    assert_eq!(on_disk, b"payload");

    // No stray temp file left behind in the target directory.
    let leftovers: Vec<_> = fs::read_dir(root.path().join("nested/dir"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(leftovers, vec![std::ffi::OsString::from("out.txt")]);
}

#[test]
fn write_file_overwrites_existing_file_atomically() {
    let root = make_root();
    write_file(root.path(), "over.txt", b"first").unwrap();
    let result = write_file(root.path(), "over.txt", b"second-longer").unwrap();
    assert_eq!(result.size, 13);
    let content = fs::read_to_string(root.path().join("over.txt")).unwrap();
    assert_eq!(content, "second-longer");
}

#[test]
fn write_file_rejects_path_escaping_root() {
    let root = make_root();
    let err = write_file(root.path(), "../escape.txt", b"x").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(!root.path().parent().unwrap().join("escape.txt").exists());
}

// --- write_file permission-bit preservation --------------------------------

#[test]
#[cfg(unix)]
fn write_file_preserves_existing_executable_permission_bit() {
    use std::os::unix::fs::PermissionsExt;

    let root = make_root();
    let path = root.path().join("script.sh");
    fs::write(&path, b"#!/bin/sh\necho hi\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

    write_file(root.path(), "script.sh", b"#!/bin/sh\necho updated\n").unwrap();

    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o755, "executable bit must survive the temp+rename swap");
    let content = fs::read_to_string(&path).unwrap();
    assert_eq!(content, "#!/bin/sh\necho updated\n");
}

#[test]
#[cfg(unix)]
fn write_file_of_a_brand_new_file_uses_default_creation_mode() {
    use std::os::unix::fs::PermissionsExt;

    let root = make_root();
    write_file(root.path(), "new.txt", b"payload").unwrap();

    let mode = fs::metadata(root.path().join("new.txt"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_ne!(mode, 0o755, "a brand-new file must not inherit an unrelated mode");
}

// --- write_file TOCTOU re-validation ----------------------------------------

#[test]
#[cfg(unix)]
fn write_file_refuses_a_parent_directory_pre_swapped_to_an_escaping_symlink() {
    use std::os::unix::fs::symlink;

    let outside = tempdir().unwrap();
    let root = make_root();
    symlink(outside.path(), root.path().join("escape")).unwrap();

    let err = write_file(root.path(), "escape/newfile.txt", b"payload").unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    assert!(!outside.path().join("newfile.txt").exists());
}

#[test]
fn revalidate_containment_allows_a_parent_still_inside_root() {
    let root = make_root();
    let parent = root.path().join("nested");
    fs::create_dir_all(&parent).unwrap();

    workspace_files::revalidate_containment(root.path(), &parent).unwrap();
}

#[test]
#[cfg(unix)]
fn revalidate_containment_refuses_a_parent_swapped_to_an_escaping_symlink() {
    use std::os::unix::fs::symlink;

    let outside = tempdir().unwrap();
    let root = make_root();
    let parent = root.path().join("nested");
    symlink(outside.path(), &parent).unwrap();

    let err = workspace_files::revalidate_containment(root.path(), &parent).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}
