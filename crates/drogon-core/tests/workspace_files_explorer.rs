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
    // A *relative* symlink target: `cap_std`'s own resolver walks this
    // directly and proves it safe, by holding the directory descriptors
    // down to `realdir` and refusing any `..` that would go above the open
    // root. See `resolving_into_an_absolute_target_symlink_is_refused_even_when_the_target_lies_inside_root`
    // for the absolute-target case, which this module does not implement
    // (see the module docs — this is explicit UNMET behavior, not a
    // considered restriction).
    symlink("realdir", root.path().join("alias")).unwrap();

    let result = read_file(root.path(), "alias/inner.txt", 1024).unwrap();
    assert_eq!(result.content, "inner");
}

#[test]
#[cfg(unix)]
fn resolving_into_an_absolute_target_symlink_is_refused_even_when_the_target_lies_inside_root() {
    // Documents a real, explicit UNMET behavior (see the module docs):
    // `cap_std`'s `Dir` has no notion of the sandbox root's real absolute
    // path to compare an absolute symlink target against, so it refuses
    // every absolute target as an escape attempt, including one that
    // happens to resolve inside `root`. A prior attempt to close this gap
    // was reverted by root ruling; this test intentionally asserts the
    // refusal, not a followed result, so a future reintroduction of that
    // gap-closing logic must consciously change this test rather than
    // silently pass.
    use std::os::unix::fs::symlink;

    let root = make_root();
    fs::create_dir(root.path().join("realdir")).unwrap();
    fs::write(root.path().join("realdir/inner.txt"), b"inner").unwrap();
    symlink(root.path().join("realdir"), root.path().join("abs-alias")).unwrap();

    let err = read_file(root.path(), "abs-alias/inner.txt", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");

    let err = list_dir(root.path(), "abs-alias", MANY).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
#[cfg(unix)]
fn list_dir_refuses_a_directory_pre_swapped_to_an_escaping_symlink() {
    use std::os::unix::fs::symlink;

    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), b"top secret").unwrap();

    let root = make_root();
    symlink(outside.path(), root.path().join("escape")).unwrap();

    let err = list_dir(root.path(), "escape", MANY).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

#[test]
#[cfg(unix)]
fn read_file_refuses_a_nested_pre_swapped_escaping_symlink_one_level_deeper() {
    use std::os::unix::fs::symlink;

    let outside = tempdir().unwrap();
    fs::write(outside.path().join("secret.txt"), b"top secret").unwrap();

    let root = make_root();
    fs::create_dir(root.path().join("real")).unwrap();
    symlink(outside.path(), root.path().join("real/escape")).unwrap();

    let err = read_file(root.path(), "real/escape/secret.txt", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
    let err = list_dir(root.path(), "real/escape", MANY).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
}

// --- handle-relative containment under a concurrent swap -------------------

#[test]
#[cfg(unix)]
fn read_file_never_returns_content_from_outside_root_while_a_component_is_concurrently_swapped() {
    use std::io::Write as _;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let outside = tempdir().unwrap();
    // Named identically to the contained case's file below, so a real leak
    // would be directly observable as this exact string coming back.
    fs::write(outside.path().join("inner.txt"), b"outside secret").unwrap();

    let root = make_root();

    let stop = Arc::new(AtomicBool::new(false));
    let stop_swapper = stop.clone();
    let swap_root = root.path().to_path_buf();
    let swapper = std::thread::spawn(move || {
        let mut toggle = false;
        while !stop_swapper.load(Ordering::Relaxed) {
            let victim = swap_root.join("victim");
            if toggle {
                // Build the contained replacement fully off to the side,
                // then rename it into place, so a reader can never observe
                // `victim` existing with a partially-written `inner.txt`.
                let staging = swap_root.join("victim-staging");
                let _ = fs::remove_dir_all(&staging);
                fs::create_dir(&staging).ok();
                if let Ok(mut f) = fs::File::create(staging.join("inner.txt")) {
                    let _ = f.write_all(b"contained");
                }
                let _ = fs::remove_dir_all(&victim);
                let _ = fs::rename(&staging, &victim);
            } else {
                let _ = fs::remove_dir_all(&victim);
                let _ = fs::remove_file(&victim);
                let _ = symlink(outside.path(), &victim);
            }
            toggle = !toggle;
        }
    });

    // Every attempt to read through the racing component must either see
    // exactly the contained file's content, or fail — with any error code,
    // since the swap thread's own churn (removing/recreating `victim`
    // between operations) can surface ordinary transient I/O errors that
    // are not themselves security-relevant. What must never happen, and is
    // the actual property under test, is `outside`'s content coming back:
    // the handle-relative design makes that true by construction, because
    // each call walks components against the open root descriptor as one
    // sequence of syscalls, leaving no separate "checked safe" moment for
    // the swapper to land in between.
    for _ in 0..300 {
        if let Ok(result) = read_file(root.path(), "victim/inner.txt", 1024) {
            assert_eq!(result.content, "contained");
        }
    }

    stop.store(true, Ordering::Relaxed);
    swapper.join().unwrap();
}

// --- FIFO/special rejection through a followed symlink ---------------------

#[test]
#[cfg(unix)]
fn read_file_rejects_a_fifo_reached_through_a_followed_contained_symlink() {
    use std::os::unix::fs::symlink;

    let root = make_root();
    fs::create_dir(root.path().join("realdir")).unwrap();
    let fifo_path = root.path().join("realdir/pipe");
    let status = std::process::Command::new("mkfifo")
        .arg(&fifo_path)
        .status()
        .expect("failed to invoke mkfifo");
    assert!(status.success(), "mkfifo command failed");
    symlink("realdir", root.path().join("alias")).unwrap();

    let err = read_file(root.path(), "alias/pipe", 1024).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
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
// Linux (and other non-Darwin unix) filesystems accept arbitrary,
// non-UTF-8 bytes in a filename. macOS's APFS/HFS+ validate filenames as
// UTF-8 at the syscall level (`EILSEQ`/"Illegal byte sequence") and refuse
// to create one at all, so there is no way to exercise this path with a
// real on-disk entry there; excluded rather than left to fail on that
// platform.
#[cfg(all(unix, not(target_os = "macos")))]
fn list_dir_rejects_a_non_utf8_entry_name_instead_of_lossily_rewriting_it() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let root = make_root();
    // Two distinct on-disk names that a lossy `to_string_lossy` rewrite
    // (replacing the invalid byte with U+FFFD) would collide onto the same
    // reported string — the exact ambiguity `into_string` must prevent by
    // failing outright instead.
    let bad_name_a = OsStr::from_bytes(b"bad-\xffname");
    let bad_name_b = OsStr::from_bytes(b"bad-\xfename");
    fs::write(root.path().join(bad_name_a), b"a").unwrap();
    fs::write(root.path().join(bad_name_b), b"b").unwrap();

    let err = list_dir(root.path(), "", MANY).unwrap_err();
    assert_eq!(err.code, "invalid_argument");
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
    // Bounded enumeration stops as soon as 3 raw entries have been
    // collected, before the directory has been fully walked, so which
    // three of the five come back depends on the filesystem's own
    // (unspecified) readdir order — only the count, the fact that each is
    // one of the five created, and that the returned page is itself sorted
    // are guaranteed.
    let names: Vec<&str> = listing.entries.iter().map(|e| e.name.as_str()).collect();
    let mut sorted_names = names.clone();
    sorted_names.sort_unstable();
    assert_eq!(names, sorted_names, "the returned page must be sorted among itself");
    for name in &names {
        assert!(
            (0..5).any(|i| *name == format!("f{i}.txt")),
            "unexpected name in bounded page: {name}"
        );
    }
}

#[test]
fn list_dir_truncates_at_two_when_five_entries_exist() {
    let root = make_root();
    for i in 0..5 {
        fs::write(root.path().join(format!("g{i}.txt")), b"x").unwrap();
    }

    let listing = list_dir(root.path(), "", 2).unwrap();
    assert!(listing.truncated);
    assert_eq!(listing.entries.len(), 2);
}

#[test]
fn list_dir_stops_enumerating_before_visiting_every_entry_in_a_large_directory() {
    let root = make_root();
    for i in 0..20_000 {
        fs::write(root.path().join(format!("bulk-{i}.txt")), b"").unwrap();
    }

    let start = std::time::Instant::now();
    let listing = list_dir(root.path(), "", 2).unwrap();
    let elapsed = start.elapsed();

    assert!(listing.truncated);
    assert_eq!(listing.entries.len(), 2);
    // Accumulate-then-truncate would stat all 20,000 entries before
    // returning; bounded early-stop only ever looks at `max_entries + 1`
    // raw entries, so this should complete near-instantly regardless of
    // directory size. A generous bound keeps this robust on slow CI while
    // still failing loudly if accumulate-then-truncate ever regresses back
    // in.
    assert!(
        elapsed < std::time::Duration::from_millis(500),
        "list_dir took {elapsed:?} for max_entries=2 over 20,000 entries; \
         bounded enumeration should not scale with directory size"
    );
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
    let result = read_file(root.path(), "ok.txt", 1024).unwrap();
    assert_eq!(result.content, "hello world");
    assert_eq!(result.size, "hello world".len() as u64);
    assert!(!result.mtime.is_empty());
}

// --- read_file bound enforcement -------------------------------------------

#[test]
fn read_file_allows_content_exactly_at_the_max_bytes_boundary() {
    let root = make_root();
    fs::write(root.path().join("exact.txt"), b"0123456789").unwrap();
    let result = read_file(root.path(), "exact.txt", 10).unwrap();
    assert_eq!(result.content, "0123456789");
    assert_eq!(result.size, 10);
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
fn read_file_does_not_block_opening_a_fifo_with_no_writer_attached() {
    // Nonblocking proof: with no writer ever attached to this FIFO, a
    // plain (blocking) `open(O_RDONLY)` against it would hang forever.
    // `read_file` opens with `O_NONBLOCK`, so this must return quickly
    // (refused, since a FIFO isn't a regular file) instead of hanging.
    let root = make_root();
    let fifo_path = root.path().join("pipe");
    let status = std::process::Command::new("mkfifo")
        .arg(&fifo_path)
        .status()
        .expect("failed to invoke mkfifo");
    assert!(status.success(), "mkfifo command failed");

    let start = std::time::Instant::now();
    let err = read_file(root.path(), "pipe", 1024).unwrap_err();
    let elapsed = start.elapsed();

    assert_eq!(err.code, "invalid_argument");
    assert!(
        elapsed < std::time::Duration::from_millis(500),
        "read_file took {elapsed:?} opening a writer-less FIFO; the open must be non-blocking"
    );
}

#[test]
#[cfg(unix)]
fn read_file_validates_the_type_of_the_handle_it_actually_opened_not_an_earlier_stat() {
    use std::io::Write as _;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let root = make_root();
    let path = root.path().join("swapme");
    fs::write(&path, b"contained").unwrap();

    // Continuously swap the target between a regular file and a directory
    // — a type change opening never blocks on, so this test can safely
    // race it many times without any risk of hanging. If `read_file`
    // trusted a stat taken before its own open, a swap landing between
    // that stat and the open could make it believe it's still looking at
    // the regular file it checked a moment ago; validating the *opened
    // handle*'s own metadata instead means it can never be fooled that
    // way.
    let stop = Arc::new(AtomicBool::new(false));
    let stop_swapper = stop.clone();
    let swap_path = path.clone();
    let staging_path = root.path().join("swapme-staging");
    let swapper = std::thread::spawn(move || {
        let mut toggle = false;
        while !stop_swapper.load(Ordering::Relaxed) {
            if toggle {
                // Write fully off to the side, then rename into place, so
                // a reader can never observe `swapme` existing as a
                // regular file with partially-written content.
                if let Ok(mut f) = fs::File::create(&staging_path) {
                    let _ = f.write_all(b"contained");
                }
                let _ = fs::remove_dir_all(&swap_path);
                let _ = fs::rename(&staging_path, &swap_path);
            } else {
                let _ = fs::remove_dir_all(&swap_path);
                let _ = fs::remove_file(&swap_path);
                fs::create_dir(&swap_path).ok();
            }
            toggle = !toggle;
        }
    });

    for _ in 0..300 {
        match read_file(root.path(), "swapme", 1024) {
            Ok(result) => assert_eq!(result.content, "contained"),
            // `not_found` is an expected, benign outcome of the swap
            // thread's own `remove_*` calls transiently emptying `swapme`
            // between operations; the property under test is that a
            // *directory* is never misreported back as file content, which
            // `invalid_argument` (from the post-open handle check) or
            // `not_found` both correctly avoid.
            Err(err) => assert!(
                err.code == "invalid_argument" || err.code == "not_found",
                "unexpected error code: {}",
                err.code
            ),
        }
    }

    stop.store(true, Ordering::Relaxed);
    swapper.join().unwrap();
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
            Ok(result) => {
                assert!(result.content.len() as u64 <= max_bytes);
                assert_eq!(result.size, result.content.len() as u64);
            }
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
fn write_file_temp_creation_is_exclusive_and_never_truncates_a_collision() {
    // Exercises the exact cap_std mechanism `write_file`'s temp-file
    // creation now relies on (`OpenOptions::create_new`, i.e. `O_EXCL`):
    // proves it refuses a name collision and — critically — never
    // truncates whatever was already occupying that name. `write_file`'s
    // own temp name embeds a fresh UUID, so a real collision can't be
    // forced from a black-box test; this verifies the primitive it is
    // built on directly.
    use cap_std::ambient_authority;
    use cap_std::fs::{Dir, OpenOptions};

    let root = make_root();
    let dir = Dir::open_ambient_dir(root.path(), ambient_authority()).unwrap();

    fs::write(root.path().join("collide.tmp"), b"pre-existing, must survive").unwrap();

    let mut opts = OpenOptions::new();
    opts.write(true).create_new(true);
    let err = dir.open_with("collide.tmp", &opts).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);

    let content = fs::read(root.path().join("collide.tmp")).unwrap();
    assert_eq!(
        content, b"pre-existing, must survive",
        "create_new must never truncate a pre-existing collision"
    );
}

#[test]
#[cfg(unix)]
fn write_file_bounds_its_post_write_readback_even_if_the_file_balloons_concurrently() {
    use std::io::Write as _;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let root = make_root();
    let path = root.path().join("ballooning.txt");
    let payload = b"expected-content";

    let stop = Arc::new(AtomicBool::new(false));
    let stop_writer = stop.clone();
    let writer_path = path.clone();
    let balloon = std::thread::spawn(move || {
        // Keep appending a large chunk in a tight loop: if `write_file`'s
        // post-rename read-back were ever unbounded, it would have to read
        // however much this thread has appended by the time it runs,
        // which grows without limit. A bounded read-back only ever looks
        // at `expected_len + 1` bytes regardless.
        let chunk = vec![b'x'; 64 * 1024];
        while !stop_writer.load(Ordering::Relaxed) {
            if let Ok(mut f) = fs::OpenOptions::new().append(true).open(&writer_path) {
                let _ = f.write_all(&chunk);
            }
        }
    });

    let start = std::time::Instant::now();
    for _ in 0..20 {
        match write_file(root.path(), "ballooning.txt", payload) {
            Ok(result) => assert_eq!(result.size, payload.len() as u64),
            // A racing append landing between the rename and the bounded
            // read-back makes the file longer than expected, which the
            // bounded read-back correctly reports as a mismatch rather
            // than silently accepting or reading the whole (ballooning)
            // file to check.
            Err(err) => assert_eq!(err.code, "internal_error"),
        }
    }
    let elapsed = start.elapsed();

    stop.store(true, Ordering::Relaxed);
    balloon.join().unwrap();

    // If the read-back were unbounded, by the end of this loop the file
    // could have grown to many megabytes and each of the 20 write_file
    // calls would have had to read all of it back; bounded to
    // `expected_len + 1` bytes, this should stay fast regardless.
    assert!(
        elapsed < std::time::Duration::from_secs(2),
        "write_file took {elapsed:?} for 20 calls against a concurrently-ballooning file; \
         the post-write read-back should not scale with the file's actual size"
    );
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
