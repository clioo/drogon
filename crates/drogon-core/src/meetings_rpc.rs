//! `meeting.list` / `meeting.read` — the RPC surface behind the Meetings page
//! and the `drogon-cli meeting` verbs.
//!
//! Both methods are read-only: they are dispatched through `dispatch_inner`
//! directly (never `Engine::mutating`), they write no rows, and they cannot
//! touch the owner's notes because `meetings::MeetingFileSystem` has no
//! mutating method at all. `meeting.read` re-validates the id against the
//! resolved notes directory on every call, so the id cannot be used as a
//! general-purpose file read.

use serde::Deserialize;
use serde_json::Value;

use crate::error;
use crate::meetings::{
    self, MAX_TRANSCRIPT_BYTES, MeetingEnvironment, MeetingReadSpecError, MeetingsParamError,
    RealMeetingFileSystem,
};
use drogon_protocol::RpcError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeetingListParams {
    #[serde(default)]
    limit: Option<u32>,
    #[serde(default)]
    offset: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MeetingReadParams {
    id: String,
    #[serde(default)]
    max_bytes: Option<u64>,
}

fn decode<T: serde::de::DeserializeOwned>(value: &Value, method: &str) -> Result<T, RpcError> {
    serde_json::from_value(value.clone())
        .map_err(|err| error::invalid_argument(format!("Invalid parameters for {method}: {err}")))
}

fn serialize<T: serde::Serialize>(value: &T, method: &str) -> Result<Value, RpcError> {
    serde_json::to_value(value).map_err(|err| {
        error::internal_error(format!("Could not encode the {method} response: {err}"))
    })
}

/// `meeting.list` with injected sources, so tests can drive every honest
/// state without reading the developer's home directory.
pub fn list_value(
    params: &Value,
    file_system: &dyn meetings::MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> Result<Value, RpcError> {
    let params: MeetingListParams = decode(params, "meeting.list")?;
    let page =
        meetings::list(file_system, environment, params.limit, params.offset).map_err(|err| {
            match err {
                MeetingsParamError::Limit => error::invalid_argument(format!(
                    "limit must be between 1 and {}",
                    meetings::MAX_PAGE_SIZE
                )),
                MeetingsParamError::Offset => {
                    error::invalid_argument("offset must be between 0 and 1000000")
                }
            }
        })?;
    serialize(&page, "meeting.list")
}

/// `meeting.read` with injected sources. `maxBytes` is bounded by the same
/// 5 MiB transcript cap the index enforces, so a caller cannot ask the
/// service to buffer an unbounded file.
pub fn read_value(
    params: &Value,
    file_system: &dyn meetings::MeetingFileSystem,
    environment: &MeetingEnvironment,
) -> Result<Value, RpcError> {
    let params: MeetingReadParams = decode(params, "meeting.read")?;
    if params
        .max_bytes
        .is_some_and(|bytes| bytes > MAX_TRANSCRIPT_BYTES)
    {
        return Err(error::invalid_argument(format!(
            "maxBytes must be between 1 and {MAX_TRANSCRIPT_BYTES}"
        )));
    }
    let outcome =
        meetings::read(file_system, environment, &params.id, params.max_bytes).map_err(|err| {
            match err {
                MeetingReadSpecError::BadMaxBytes => error::invalid_argument(format!(
                    "maxBytes must be between 1 and {MAX_TRANSCRIPT_BYTES}"
                )),
                MeetingReadSpecError::Read(read_error) => {
                    RpcError::new(read_error.as_wire(), read_error.message())
                }
            }
        })?;
    serialize(&outcome, "meeting.read")
}

impl crate::Engine {
    pub(crate) fn do_meeting_list(&self, params: &Value) -> Result<Value, RpcError> {
        list_value(
            params,
            &RealMeetingFileSystem,
            &MeetingEnvironment::current(),
        )
    }

    pub(crate) fn do_meeting_read(&self, params: &Value) -> Result<Value, RpcError> {
        read_value(
            params,
            &RealMeetingFileSystem,
            &MeetingEnvironment::current(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meetings::filesystem::tests::FakeFileSystem;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn environment() -> MeetingEnvironment {
        MeetingEnvironment {
            platform: "macos".into(),
            home_dir: PathBuf::from("/home/carlos"),
            variables: BTreeMap::new(),
            app_candidates: vec![PathBuf::from("/Applications/WriteThatDown.app")],
        }
    }

    fn fixture() -> FakeFileSystem {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/Applications/WriteThatDown.app/Contents/MacOS/WriteThatDown",
            b"binary",
        );
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-10/08-00_30min.md",
            b"# Standup\n**Date:** 2026-09-10 08:00\n**Duration:** 30 min\n\n## Transcript\n\n[00:00] hola\n",
        );
        fs
    }

    #[test]
    fn list_defaults_to_the_contract_page_and_reads_both_fields() {
        let fs = fixture();
        let value = list_value(&json!({}), &fs, &environment()).unwrap();
        assert_eq!(value["limit"], 50);
        assert_eq!(value["offset"], 0);
        assert_eq!(value["total"], 1);
        assert_eq!(value["meetings"][0]["title"], "Standup");
        assert_eq!(value["availability"]["reason"], "ready");

        let value = list_value(&json!({"limit": 1, "offset": 0}), &fs, &environment()).unwrap();
        assert_eq!(value["meetings"].as_array().unwrap().len(), 1);

        let read = read_value(
            &json!({"id": value["meetings"][0]["id"].clone()}),
            &fs,
            &environment(),
        )
        .unwrap();
        assert!(read["content"].as_str().unwrap().contains("[00:00] hola"));
        assert_eq!(read["truncated"], false);
        assert_eq!(read["meeting"]["status"], "saved");
    }

    #[test]
    fn unknown_fields_and_malformed_params_are_refused() {
        let fs = fixture();
        let env = environment();
        for params in [
            json!({"limits": 1}),
            json!({"limit": 1.5}),
            json!({"offset": -1}),
            json!({"limit": "all"}),
        ] {
            assert!(
                list_value(&params, &fs, &env).is_err(),
                "{params} must fail"
            );
        }
        for params in [json!({}), json!({"ids": "x"}), json!({"id": 7})] {
            assert!(
                read_value(&params, &fs, &env).is_err(),
                "{params} must fail"
            );
        }
    }

    #[test]
    fn page_and_byte_bounds_are_refused_not_clamped() {
        let fs = fixture();
        let env = environment();
        let failure = list_value(&json!({"limit": 0}), &fs, &env).unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
        let failure = list_value(&json!({"limit": 201}), &fs, &env).unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
        let failure = read_value(
            &json!({"id": "x", "maxBytes": MAX_TRANSCRIPT_BYTES + 1}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
        let failure = read_value(&json!({"id": "x", "maxBytes": 0}), &fs, &env).unwrap_err();
        assert_eq!(failure.code, "invalid_argument");
    }

    #[test]
    fn read_failures_carry_their_own_codes() {
        let mut fs = fixture();
        let env = environment();
        let missing = read_value(
            &json!({"id": "write-that-down:/home/carlos/Transcripts/2026-09-10/09-00_30min.md"}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(missing.code, "meeting_missing");
        assert!(!missing.retryable);

        let outside = read_value(
            &json!({"id": "write-that-down:/home/carlos/.ssh/id_rsa"}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(outside.code, "meeting_outside_root");

        fs.insert_file("/etc/passwd", b"root:x:0:0");
        let traversal = read_value(
            &json!({"id": "write-that-down:/home/carlos/Transcripts/../../etc/passwd"}),
            &fs,
            &env,
        )
        .unwrap_err();
        assert_eq!(traversal.code, "meeting_outside_root");
    }

    #[test]
    fn an_uninstalled_tool_still_lists_compatible_transcripts() {
        let mut fs = FakeFileSystem::default();
        fs.insert_file(
            "/home/carlos/Transcripts/2026-09-10/08-00_30min.md",
            b"# Standup\n**Date:** 2026-09-10 08:00\n**Duration:** 30 min\n\n## Transcript\n\nhello\n",
        );
        let value = list_value(&json!({}), &fs, &environment()).unwrap();
        assert_eq!(value["availability"]["reason"], "not-installed");
        assert_eq!(value["meetings"].as_array().unwrap().len(), 1);
    }
}
