use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::HarnessId;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HarnessAvailability {
    Available,
    Missing,
    UnsupportedLauncher,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInstallation {
    pub harness_id: HarnessId,
    pub display_name: &'static str,
    pub availability: HarnessAvailability,
    pub executable: Option<PathBuf>,
}

/// PATH belongs to the execution host; relative entries cannot pick up project executables.
pub fn discover(search_path: Option<&OsStr>) -> Vec<HarnessInstallation> {
    let directories: Vec<_> = search_path
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .filter(|path| path.is_absolute())
        .collect();
    HarnessId::ALL
        .into_iter()
        .map(|harness_id| {
            let executable = directories
                .iter()
                .find_map(|directory| find_executable(directory, harness_id.executable()));
            let availability = match executable.as_ref() {
                None => HarnessAvailability::Missing,
                Some(path) if is_script_launcher(path) => HarnessAvailability::UnsupportedLauncher,
                Some(_) => HarnessAvailability::Available,
            };
            HarnessInstallation {
                harness_id,
                display_name: harness_id.display_name(),
                availability,
                executable,
            }
        })
        .collect()
}

fn find_executable(directory: &Path, command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = [
        format!("{command}.exe"),
        format!("{command}.com"),
        format!("{command}.cmd"),
        format!("{command}.bat"),
    ];
    #[cfg(not(windows))]
    let names = [command.to_owned()];
    names.into_iter().find_map(|name| {
        let path = directory.join(name);
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() {
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
        }
        std::fs::canonicalize(path)
            .ok()
            .filter(|path| path.to_str().is_some())
    })
}

pub(crate) fn is_script_launcher(path: &Path) -> bool {
    cfg!(windows)
        && path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
            })
}
