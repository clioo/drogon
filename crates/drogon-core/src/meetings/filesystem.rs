//! Read-only filesystem seam for the Meetings surface.
//!
//! Every read the meetings index performs goes through this trait, so the
//! honest states (missing directory, unreadable directory, unreadable file,
//! oversized file) are injectable in tests without touching the real disk and
//! without ever gaining a write path: the trait has no mutating method, so a
//! future change cannot accidentally edit, move or delete the owner's notes.

use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Directory,
    Other,
}

#[derive(Debug, Clone)]
pub struct DirEntryInfo {
    pub name: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Copy)]
pub struct FileMetadata {
    pub size: u64,
    pub is_file: bool,
    pub is_dir: bool,
}

pub trait MeetingFileSystem: Send + Sync {
    fn read_dir(&self, path: &Path) -> io::Result<Vec<DirEntryInfo>>;
    fn metadata(&self, path: &Path) -> io::Result<FileMetadata>;
    fn read_file(&self, path: &Path) -> io::Result<Vec<u8>>;
    /// The first `max_bytes` of a file (or the whole file, when shorter).
    ///
    /// Indexing a 327-transcript folder must not pull 327 whole
    /// conversations into memory to render a list: every field a row shows
    /// — title, date, duration, status and a ~400-character excerpt — lives
    /// in the file's own header, so the walk reads a bounded window and only
    /// falls back to [`Self::read_file`] when the window cannot decide.
    fn read_prefix(&self, path: &Path, max_bytes: u64) -> io::Result<Vec<u8>>;
}

/// The real filesystem. Reads only; `std::fs::read`/`read_dir`/`metadata`
/// cannot create, truncate or remove anything.
#[derive(Debug, Default)]
pub struct RealMeetingFileSystem;

impl MeetingFileSystem for RealMeetingFileSystem {
    fn read_dir(&self, path: &Path) -> io::Result<Vec<DirEntryInfo>> {
        let entries = std::fs::read_dir(path)?;
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let kind = if file_type.is_dir() {
                EntryKind::Directory
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            out.push(DirEntryInfo {
                name: entry.file_name().to_string_lossy().into_owned(),
                kind,
            });
        }
        Ok(out)
    }

    fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
        let meta = std::fs::metadata(path)?;
        Ok(FileMetadata {
            size: meta.len(),
            is_file: meta.is_file(),
            is_dir: meta.is_dir(),
        })
    }

    fn read_file(&self, path: &Path) -> io::Result<Vec<u8>> {
        std::fs::read(path)
    }

    fn read_prefix(&self, path: &Path, max_bytes: u64) -> io::Result<Vec<u8>> {
        use std::io::Read as _;
        let file = std::fs::File::open(path)?;
        let mut out = Vec::new();
        file.take(max_bytes).read_to_end(&mut out)?;
        Ok(out)
    }
}

/// Which of the three honest directory states a path is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryState {
    Missing,
    Unreadable,
    Readable,
}

/// Missing means "there is no directory at this path" (including a path that
/// exists as a regular file); unreadable means it is a directory this process
/// cannot list. The two are distinct on purpose: the UI must never render
/// "you have no meetings" when the truth is "this path does not exist".
pub fn inspect_directory(file_system: &dyn MeetingFileSystem, path: &Path) -> DirectoryState {
    match file_system.metadata(path) {
        Ok(meta) if meta.is_dir => {}
        _ => return DirectoryState::Missing,
    }
    match file_system.read_dir(path) {
        Ok(_) => DirectoryState::Readable,
        Err(_) => DirectoryState::Unreadable,
    }
}

/// `true` when `child` is `parent` itself or lives under it. Used to refuse a
/// `meeting.read` id that points outside the resolved notes directory.
pub fn path_is_inside(parent: &Path, child: &Path) -> bool {
    let parent = normalize(parent);
    let child = normalize(child);
    child.starts_with(&parent)
}

/// Lexical normalization: resolve `.`/`..` without touching the disk (the
/// file may not exist). Absolute inputs stay absolute.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !out.pop() && !path.is_absolute() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};

    /// In-memory read-only filesystem with injectable failures. Every
    /// meetings unit test drives this instead of the real disk, so the
    /// unreadable/oversized/missing states are deterministic.
    #[derive(Debug, Default)]
    pub struct FakeFileSystem {
        files: BTreeMap<PathBuf, Vec<u8>>,
        dirs: BTreeSet<PathBuf>,
        unreadable_dirs: BTreeSet<PathBuf>,
        unreadable_files: BTreeSet<PathBuf>,
        missing_metadata: BTreeSet<PathBuf>,
    }

    impl FakeFileSystem {
        pub fn insert_file(&mut self, path: &str, bytes: &[u8]) {
            let path = PathBuf::from(path);
            self.insert_ancestors(&path);
            self.files.insert(path, bytes.to_vec());
        }

        pub fn insert_dir(&mut self, path: &str) {
            let path = PathBuf::from(path);
            self.insert_ancestors(&path);
            self.dirs.insert(path);
        }

        fn insert_ancestors(&mut self, path: &Path) {
            let mut current = path.parent();
            while let Some(dir) = current {
                if dir.as_os_str().is_empty() {
                    break;
                }
                self.dirs.insert(dir.to_path_buf());
                current = dir.parent();
            }
        }

        /// `read_dir` on this path fails (a directory without search
        /// permission, the `transcript-root-unreadable` state).
        pub fn make_dir_unreadable(&mut self, path: &str) {
            self.unreadable_dirs.insert(PathBuf::from(path));
        }

        /// `read` on this file fails (the `unreadable-transcript` state).
        pub fn make_file_unreadable(&mut self, path: &str) {
            self.unreadable_files.insert(PathBuf::from(path));
        }

        pub fn make_metadata_fail(&mut self, path: &str) {
            self.missing_metadata.insert(PathBuf::from(path));
        }

        pub fn file_paths(&self) -> Vec<&Path> {
            self.files.keys().map(PathBuf::as_path).collect()
        }
    }

    impl MeetingFileSystem for FakeFileSystem {
        fn read_dir(&self, path: &Path) -> io::Result<Vec<DirEntryInfo>> {
            if self.missing_metadata.contains(path) {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
            }
            if self.unreadable_dirs.contains(path) {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
            }
            if !self.dirs.contains(path) {
                return Err(io::Error::new(io::ErrorKind::NotFound, "missing"));
            }
            let mut out = Vec::new();
            for file in self.files.keys() {
                if file.parent() == Some(path) {
                    out.push(DirEntryInfo {
                        name: file.file_name().unwrap().to_string_lossy().into_owned(),
                        kind: EntryKind::File,
                    });
                }
            }
            for dir in &self.dirs {
                if dir.parent() == Some(path) {
                    out.push(DirEntryInfo {
                        name: dir.file_name().unwrap().to_string_lossy().into_owned(),
                        kind: EntryKind::Directory,
                    });
                }
            }
            out.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(out)
        }

        fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
            if self.missing_metadata.contains(path) {
                return Err(io::Error::new(io::ErrorKind::NotFound, "missing"));
            }
            if let Some(bytes) = self.files.get(path) {
                return Ok(FileMetadata {
                    size: bytes.len() as u64,
                    is_file: true,
                    is_dir: false,
                });
            }
            if self.dirs.contains(path) {
                return Ok(FileMetadata {
                    size: 0,
                    is_file: false,
                    is_dir: true,
                });
            }
            Err(io::Error::new(io::ErrorKind::NotFound, "missing"))
        }

        fn read_file(&self, path: &Path) -> io::Result<Vec<u8>> {
            if self.unreadable_files.contains(path) {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
            }
            self.files
                .get(path)
                .cloned()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing"))
        }

        fn read_prefix(&self, path: &Path, max_bytes: u64) -> io::Result<Vec<u8>> {
            let bytes = <Self as MeetingFileSystem>::read_file(self, path)?;
            let limit = usize::try_from(max_bytes)
                .unwrap_or(usize::MAX)
                .min(bytes.len());
            Ok(bytes[..limit].to_vec())
        }
    }

    #[test]
    fn normalizes_dot_and_dotdot_without_the_disk() {
        assert_eq!(
            normalize(Path::new("/a/b/../c/./d")),
            PathBuf::from("/a/c/d")
        );
        assert_eq!(normalize(Path::new("rel/../x")), PathBuf::from("x"));
        assert_eq!(normalize(Path::new("/a/../../b")), PathBuf::from("/b"));
    }

    #[test]
    fn containment_refuses_traversal_and_siblings() {
        let root = Path::new("/root/Transcripts");
        assert!(path_is_inside(root, Path::new("/root/Transcripts")));
        assert!(path_is_inside(
            root,
            Path::new("/root/Transcripts/2026-09-10/a.md")
        ));
        assert!(path_is_inside(
            root,
            Path::new("/root/Transcripts/../Transcripts/x.md")
        ));
        assert!(!path_is_inside(
            root,
            Path::new("/root/Transcripts-evil/a.md")
        ));
        assert!(!path_is_inside(root, Path::new("/root/other/a.md")));
        assert!(!path_is_inside(
            root,
            Path::new("/root/Transcripts/../../etc/passwd")
        ));
    }

    #[test]
    fn fake_filesystem_reports_the_three_directory_states() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file("/root/Transcripts/2026-09-10/08-00_5min.md", b"x");
        assert_eq!(
            inspect_directory(&fs, Path::new("/root/Transcripts")),
            DirectoryState::Readable
        );
        assert_eq!(
            inspect_directory(&fs, Path::new("/root/elsewhere")),
            DirectoryState::Missing
        );
        fs.make_dir_unreadable("/root/Transcripts");
        assert_eq!(
            inspect_directory(&fs, Path::new("/root/Transcripts")),
            DirectoryState::Unreadable
        );
    }

    /// Counts what the index actually reads. The "never pull 327 files into
    /// memory to render a list" guarantee is a property of the read
    /// pattern, so it is asserted against the filesystem seam rather than
    /// inferred from timings.
    #[derive(Debug, Default)]
    pub struct CountingFileSystem {
        inner: FakeFileSystem,
        pub full_reads: std::sync::Mutex<Vec<PathBuf>>,
        pub prefix_reads: std::sync::Mutex<Vec<(PathBuf, u64)>>,
    }

    impl CountingFileSystem {
        pub fn inner_mut(&mut self) -> &mut FakeFileSystem {
            &mut self.inner
        }

        pub fn file_reads(&self) -> usize {
            self.full_reads.lock().unwrap().len()
        }

        pub fn prefix_reads(&self) -> usize {
            self.prefix_reads.lock().unwrap().len()
        }

        pub fn prefix_read_bytes(&self) -> u64 {
            self.prefix_reads
                .lock()
                .unwrap()
                .iter()
                .map(|(_, bytes)| *bytes)
                .sum()
        }

        pub fn paths_read_in_full(&self) -> Vec<PathBuf> {
            self.full_reads.lock().unwrap().clone()
        }
    }

    impl MeetingFileSystem for CountingFileSystem {
        fn read_dir(&self, path: &Path) -> io::Result<Vec<DirEntryInfo>> {
            self.inner.read_dir(path)
        }

        fn metadata(&self, path: &Path) -> io::Result<FileMetadata> {
            self.inner.metadata(path)
        }

        fn read_file(&self, path: &Path) -> io::Result<Vec<u8>> {
            self.full_reads.lock().unwrap().push(path.to_path_buf());
            self.inner.read_file(path)
        }

        fn read_prefix(&self, path: &Path, max_bytes: u64) -> io::Result<Vec<u8>> {
            self.prefix_reads
                .lock()
                .unwrap()
                .push((path.to_path_buf(), max_bytes));
            self.inner.read_prefix(path, max_bytes)
        }
    }

    #[test]
    fn read_prefix_returns_a_bounded_window() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/root/Transcripts/2026-09-10/08-00_5min.md",
            b"# Meeting\nbody",
        );
        let path = Path::new("/root/Transcripts/2026-09-10/08-00_5min.md");
        assert_eq!(fs.read_prefix(path, 9).unwrap(), b"# Meeting");
        assert_eq!(
            fs.read_prefix(path, 4096).unwrap(),
            b"# Meeting\nbody".to_vec()
        );
        assert!(fs.read_prefix(path, 0).unwrap().is_empty());
    }

    #[test]
    fn a_regular_file_at_the_notes_path_reads_as_missing_not_unreadable() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file("/root/Transcripts", b"not a directory");
        assert_eq!(
            inspect_directory(&fs, Path::new("/root/Transcripts")),
            DirectoryState::Missing
        );
    }
}
