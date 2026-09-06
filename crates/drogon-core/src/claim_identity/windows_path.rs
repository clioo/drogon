//! Pure Windows canonical-path normalization seam.
//!
//! Rust's `fs::canonicalize` documents that on Windows it "converts the path
//! to use extended length path syntax" (`\\?\C:\...` /
//! `\\?\UNC\server\share\...` via `GetFinalPathNameByHandle`), while the
//! pinned TypeScript source signs `normalize(realpathSync(value))` lowercased
//! with `toLocaleLowerCase('en-US')`, and Node 24.19.0's `realpathSync`
//! (lib/fs.js, a pure-JS walk over `path.resolve` output) returns *ordinary*
//! spellings for ordinary inputs and preserves only *explicitly typed*
//! device namespaces. Mapping Rust's canonical output back to the source's
//! spellings keeps the signed transcript bytes wire-compatible.
//!
//! This seam is deliberately pure (no filesystem access) so the exact
//! transformations are testable on any host; `cfg(windows)` real-filesystem
//! tests exercise it against an actual Windows kernel elsewhere in the
//! suite. macOS string tests prove only the transformation, not Windows
//! runtime parity.

/// Returns the canonical-path spelling the pinned source would sign for
/// `original` (the transcript path as given) whose Rust-canonicalized form is
/// `canonical`.
///
/// Expected transformations (source-backed; see module docs):
/// - ordinary drive input: canonical `\\?\C:\Foo` -> `c:\foo`
/// - ordinary UNC input: canonical `\\?\UNC\Server\Share\X` -> `\\server\share\x`
/// - explicitly namespaced `\\?\` input (drive or UNC, either separator
///   style): the source preserves the typed namespace, so the canonical form
///   is kept (only lowercased)
/// - explicitly namespaced `\\.\` input (drive or the `\\.\UNC\...`
///   device-UNC form): Rust canonicalize reports the same file with a `\\?\`
///   prefix, so the seam reconstructs the source's `\\.` spelling on the
///   canonical target bytes
/// - anything else is lowercased unchanged.
pub(crate) fn normalize_windows_canonical_path(original: &str, canonical: &str) -> String {
    let namespace = explicit_device_namespace(original);
    if namespace == Some(b'?') {
        // Source preserves the typed `\\?` namespace; Rust canonicalize
        // happens to report the identical `\\?\` spelling: keep it.
        canonical.to_lowercase()
    } else if namespace == Some(b'.') {
        // Source preserves the typed `\\.` namespace (lib/path.js device
        // root), but Rust canonicalize always reports the `\\?\` form:
        // swap the namespace character on the canonical bytes.
        canonical.replacen("\\\\?\\", "\\\\.\\", 1).to_lowercase()
    } else {
        strip_extended_length_prefix(canonical).to_lowercase()
    }
}

/// Node's `path.win32.resolve` (lib/path.js) treats `\\?`/ `\\.` as a device
/// root and preserves it; the realpath walk (lib/fs.js splitRoot) keeps it.
/// Separators are interchangeable in Node (`isPathSeparator` accepts `/` and
/// `\`), so both `\\.\C:\...` and `//./C:/...` forms are recognized. Returns
/// the namespace character (`b'?'` or `b'.'`).
fn explicit_device_namespace(path: &str) -> Option<u8> {
    let bytes = path.as_bytes();
    if bytes.len() >= 4
        && matches!(bytes[0], b'\\' | b'/')
        && matches!(bytes[1], b'\\' | b'/')
        && matches!(bytes[2], b'?' | b'.')
        && matches!(bytes[3], b'\\' | b'/')
    {
        Some(bytes[2])
    } else {
        None
    }
}

/// Strips the `\\?\` extended-length prefix that Rust's `fs::canonicalize`
/// adds on Windows, then remaps Rust's `\\?\UNC\server\share` rendering of
/// ordinary UNC roots back to the `\\server\share` spelling Node's
/// `realpathSync` produces. Spellings that are not Rust canonicalize output
/// for ordinary drive/UNC paths (e.g. volume-GUID forms, or an unprefixed
/// input) pass through unchanged.
fn strip_extended_length_prefix(path: &str) -> String {
    let Some(rest) = path.strip_prefix("\\\\?\\") else {
        return path.to_string();
    };
    match rest.get(..4) {
        Some(prefix) if prefix.eq_ignore_ascii_case("UNC\\") => format!("\\\\{}", &rest[4..]),
        _ => rest.to_string(),
    }
}
