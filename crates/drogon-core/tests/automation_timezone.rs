//! Timezone schedules (C08): IANA-zone admission, zoned fire computation
//! with the frozen DST policy, zone edits, and gap-slot ticks that record
//! a skip without dispatching. Nothing here launches a harness process:
//! gap ticks record `SkippedMissed` rows through the DB only, and every
//! other case is pure computation or `automation.*` admission RPCs against
//! a real `Engine` in a temp data dir. Live-fire duplication/restart
//! coverage stays in `automation_scheduler.rs` (untouched by this change).

use drogon_core::Engine;
use drogon_core::automations::{scheduler, timezone};
use drogon_protocol::{PROTOCOL_VERSION, Request, Response};
use serde_json::{Value, json};

/// Monday 2026-09-07T00:00:00Z in millisecond epoch.
const MONDAY_MIDNIGHT_MS: f64 = 1_788_739_200_000.0;

const NY: &str = "America/New_York";

fn request(id: &str, method: &str, params: Value) -> Request {
    Request {
        protocol: PROTOCOL_VERSION,
        request_id: id.into(),
        auth: None,
        method: method.into(),
        params,
    }
}

fn ok(response: Response) -> Value {
    assert!(response.ok, "{response:?}");
    response.result.unwrap()
}

fn err_code(response: Response) -> String {
    assert!(!response.ok, "expected error, got {response:?}");
    response.error.unwrap().code
}

fn engine_with_workspace(dir: &tempfile::TempDir) -> (Engine, String) {
    let engine = Engine::open(dir.path()).unwrap();
    let workspace_dir = dir.path().join("work");
    std::fs::create_dir_all(&workspace_dir).unwrap();
    let registered = ok(engine.dispatch(request(
        "ws-1",
        "workspace.register",
        json!({"path": workspace_dir.to_string_lossy()}),
    )));
    let workspace_id = registered["id"].as_str().unwrap().to_string();
    (engine, workspace_id)
}

fn create_zoned(
    engine: &Engine,
    id: &str,
    workspace_id: &str,
    cron: &str,
    timezone: Option<&str>,
) -> Value {
    let mut params = json!({
        "name": format!("auto-{id}"),
        "cron": cron,
        "workspaceId": workspace_id,
        "harness": "pi",
        "prompt": "fixture sweep",
    });
    if let Some(zone) = timezone {
        params["timezone"] = json!(zone);
    }
    ok(engine.dispatch(request(id, "automation.create", params)))
}

fn history(engine: &Engine, automation_id: &str) -> Vec<Value> {
    let result = ok(engine.dispatch(request(
        "hist",
        "automation.history",
        json!({"automationId": automation_id}),
    )));
    result["runs"].as_array().unwrap().clone()
}

#[test]
fn absent_timezone_means_utc_and_invalid_rejects() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);

    // Canonical wire contract: the summary always carries the effective
    // zone (normalize stores it, summarize projects it verbatim), so a
    // legacy row reads "UTC" rather than omitting the key. There is no
    // absent-vs-null tri-state; pre-zone readers treat an absent key as
    // UTC and strip the unknown key either way.
    let legacy = create_zoned(&engine, "legacy-1", &workspace_id, "* * * * *", None);
    assert_eq!(legacy["timezone"], json!("UTC"));
    let legacy_id = legacy["id"].as_str().unwrap().to_string();

    // Explicit zone round-trips on the summary.
    let zoned = create_zoned(&engine, "zoned-1", &workspace_id, "0 9 * * *", Some(NY));
    assert_eq!(zoned["timezone"], json!(NY));

    // Unknown zones reject at admission, never coerce to UTC.
    let bad_create = engine.dispatch(request(
        "bad-1",
        "automation.create",
        json!({
            "name": "bad", "cron": "* * * * *", "timezone": "Mars/Olympus",
            "workspaceId": workspace_id, "harness": "pi", "prompt": "x",
        }),
    ));
    assert_eq!(err_code(bad_create), "invalid_argument");

    let bad_update = engine.dispatch(request(
        "bad-2",
        "automation.update",
        json!({"id": legacy_id, "timezone": "Mars/Olympus"}),
    ));
    assert_eq!(err_code(bad_update), "invalid_argument");
}

#[test]
fn utc_evaluation_matches_the_legacy_path() {
    // Self-check the fixture helper against the suite's known Monday.
    assert_eq!(utc_ms(2026, 8, 7, 0, 0), MONDAY_MIDNIGHT_MS as i64);
    // The zoned entry point must reproduce legacy UTC fires exactly for
    // rows stored without a zone.
    for cron in [
        "* * * * *",
        "30 8 * * *",
        "0 9 * * 1-5",
        "*/15 9-17 * * 1",
        "0 0 29 2 *",
        "0 0 1 1 *",
    ] {
        let legacy = scheduler::next_fire_ms(cron, MONDAY_MIDNIGHT_MS).unwrap();
        assert_eq!(
            timezone::next_native_fire_ms(cron, "UTC", MONDAY_MIDNIGHT_MS),
            Some(legacy),
            "UTC zone must match legacy for {cron}"
        );
        assert_eq!(
            timezone::next_native_fire_ms(cron, "", MONDAY_MIDNIGHT_MS),
            Some(legacy),
            "blank zone must match legacy for {cron}"
        );
    }
}

#[test]
fn zoned_gap_skips_and_fold_singles_match_the_renderer_vectors() {
    // Same fixtures as automation-timezone-preview.test.ts: preview and
    // backend must agree fire-for-fire. Mar 8 2026 02:30 does not exist
    // in America/New_York (spring forward); Nov 1 01:30 happens twice.
    let gap = timezone::preview_fires_in_zone("30 2 * * *", NY, utc_ms(2026, 2, 7, 0, 0) as f64, 3)
        .unwrap();
    assert_eq!(gap.timezone, NY);
    assert_eq!(
        gap.fires,
        vec![
            utc_ms(2026, 2, 7, 7, 30),
            utc_ms(2026, 2, 9, 6, 30),
            utc_ms(2026, 2, 10, 6, 30),
        ]
    );
    assert_eq!(gap.skipped.len(), 1);
    assert_eq!(gap.skipped[0].local_date, "2026-03-08");
    assert_eq!(gap.skipped[0].wall_time, "02:30");

    let fold =
        timezone::preview_fires_in_zone("30 1 * * *", NY, utc_ms(2026, 9, 31, 12, 0) as f64, 3)
            .unwrap();
    assert_eq!(
        fold.fires,
        vec![
            utc_ms(2026, 10, 1, 5, 30),
            utc_ms(2026, 10, 2, 6, 30),
            utc_ms(2026, 10, 3, 6, 30),
        ]
    );
    assert!(fold.skipped.is_empty());

    // Interval schedules have no fire and no skip inside the gap.
    let interval =
        timezone::preview_fires_in_zone("* * * * *", NY, utc_ms(2026, 2, 8, 6, 59) as f64, 3)
            .unwrap();
    assert_eq!(
        interval.fires,
        vec![
            utc_ms(2026, 2, 8, 7, 0),
            utc_ms(2026, 2, 8, 7, 1),
            utc_ms(2026, 2, 8, 7, 2),
        ]
    );
    assert!(interval.skipped.is_empty());
    assert!(!timezone::is_gap_slot(
        "* * * * *",
        NY,
        utc_ms(2026, 2, 8, 7, 0) as f64
    ));

    // The fold's first occurrence is a real slot, not a gap.
    assert!(!timezone::is_gap_slot(
        "30 1 * * *",
        NY,
        utc_ms(2026, 10, 1, 5, 30) as f64
    ));

    // Interval fold: every repeated wall fires at its first occurrence
    // only; the later halves never surface as fires or skips.
    let fold_interval =
        timezone::preview_fires_in_zone("*/30 1 * * *", NY, utc_ms(2026, 10, 1, 4, 59) as f64, 4)
            .unwrap();
    assert_eq!(
        fold_interval.fires,
        vec![
            utc_ms(2026, 10, 1, 5, 0),
            utc_ms(2026, 10, 1, 5, 30),
            utc_ms(2026, 10, 2, 6, 0),
            utc_ms(2026, 10, 2, 6, 30),
        ]
    );
    assert!(fold_interval.skipped.is_empty());
    // Resume from between the fold halves: both later halves are passed
    // over, the next fires are the next day's single occurrences.
    let fold_resume =
        timezone::preview_fires_in_zone("*/30 1 * * *", NY, utc_ms(2026, 10, 1, 5, 45) as f64, 2)
            .unwrap();
    assert_eq!(
        fold_resume.fires,
        vec![utc_ms(2026, 10, 2, 6, 0), utc_ms(2026, 10, 2, 6, 30),]
    );
    assert!(fold_resume.skipped.is_empty());

    // Seconds-granularity fold: a six-field wall inside the overlap
    // fires at its first occurrence, and resuming inside the later half
    // jumps past the overlap without losing the first wall after it.
    let fold_seconds =
        timezone::preview_fires_in_zone("30 0 1 * * *", NY, utc_ms(2026, 10, 1, 4, 59) as f64, 2)
            .unwrap();
    assert_eq!(
        fold_seconds.fires,
        vec![
            utc_ms(2026, 10, 1, 5, 0) + 30_000,
            utc_ms(2026, 10, 2, 6, 0) + 30_000,
        ]
    );
    assert!(fold_seconds.skipped.is_empty());
    let fold_seconds_resume =
        timezone::preview_fires_in_zone("30 0 1 * * *", NY, utc_ms(2026, 10, 1, 6, 0) as f64, 1)
            .unwrap();
    assert_eq!(
        fold_seconds_resume.fires,
        vec![utc_ms(2026, 10, 2, 6, 0) + 30_000]
    );
    assert!(fold_seconds_resume.skipped.is_empty());
}

/// (Month, day, hour, minute) wall time of a millisecond-epoch instant in
/// an IANA zone. Year is deliberately excluded: schedule walls recur
/// yearly, so assertions on them hold no matter when the test runs.
fn wall_in_zone(ms: f64, zone: &str) -> (u32, u32, u32, u32) {
    use chrono::{DateTime, Datelike, Timelike, Utc};
    let utc = DateTime::<Utc>::from_timestamp((ms / 1000.0).floor() as i64, 0).unwrap();
    let tz: chrono_tz::Tz = zone.parse().unwrap();
    let local = utc.with_timezone(&tz).naive_local();
    (local.month(), local.day(), local.hour(), local.minute())
}

/// Millisecond epoch for a UTC wall time, taking a 0-based month like
/// JavaScript `Date.UTC` so fixtures read identically on both sides.
/// Same civil calendar as the scheduler's own conversion.
fn utc_ms(year: i32, month0: u32, day: u32, hour: u32, minute: u32) -> i64 {
    let month = month0 + 1;
    let y = if month <= 2 { year - 1 } else { year } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    days * 86_400_000 + hour as i64 * 3_600_000 + minute as i64 * 60_000
}

#[test]
fn zone_edit_recomputes_the_next_run_in_the_new_zone() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);

    // Yearly Jan-1 midnight. Wall assertions hold for any run date:
    // each stored instant renders as Jan-1 midnight in its own zone.
    // Future- and first-occurrence oracles for this scenario live with
    // fixed clocks in the admission unit tests (`automation_rpc.rs`),
    // where no real-clock race is possible.
    let created = create_zoned(&engine, "edit-1", &workspace_id, "0 0 1 1 *", None);
    let automation_id = created["id"].as_str().unwrap().to_string();
    let utc_next = created["nextRunAt"].as_f64().unwrap();
    assert_eq!(wall_in_zone(utc_next, "UTC"), (1, 1, 0, 0));

    let updated = ok(engine.dispatch(request(
        "edit-2",
        "automation.update",
        json!({"id": automation_id, "timezone": NY}),
    )));
    assert_eq!(updated["timezone"], json!(NY));
    let ny_next = updated["nextRunAt"].as_f64().unwrap();
    assert_eq!(wall_in_zone(ny_next, NY), (1, 1, 0, 0));

    // History survives the zone edit (no rows fabricated by the edit).
    assert!(history(&engine, &automation_id).is_empty());
}

#[test]
fn gap_slot_tick_records_skip_without_dispatching() {
    let dir = tempfile::tempdir().unwrap();
    let (engine, workspace_id) = engine_with_workspace(&dir);

    // Mar 14 2027 is the US spring-forward Sunday: 02:30 never happens in
    // America/New_York, so the stored next run is the shifted 03:00 EDT
    // instant, which the tick must record skipped, never dispatch.
    let created = create_zoned(&engine, "gap-1", &workspace_id, "30 2 14 3 *", Some(NY));
    let automation_id = created["id"].as_str().unwrap().to_string();
    let slot = created["nextRunAt"].as_f64().unwrap();
    assert!(timezone::is_gap_slot("30 2 14 3 *", NY, slot));

    // Just past the shifted slot: one skip row, zero dispatches, and the
    // schedule advances to the next year.
    let summary = scheduler::tick_once(&engine, slot + 1_000.0);
    assert_eq!(summary.checked, 1);
    assert_eq!(summary.fired, 0);
    assert_eq!(summary.skipped_missed, 1);

    let runs = history(&engine, &automation_id);
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0]["status"], json!("skipped_missed"));
    assert_eq!(runs[0]["scheduledFor"], json!(slot));
    assert!(runs[0]["error"].as_str().unwrap().contains("DST gap"));

    // A duplicate tick for the same slot upserts the same row: still one.
    let repeat = scheduler::tick_once(&engine, slot + 1_000.0);
    assert_eq!(repeat.fired, 0);
    assert_eq!(repeat.skipped_missed, 0);
    assert_eq!(history(&engine, &automation_id).len(), 1);

    // Restart around the due time: the advanced schedule does not refire
    // and the skip row is not duplicated.
    drop(engine);
    let reopened = Engine::open(dir.path()).unwrap();
    let after_restart = scheduler::tick_once(&reopened, slot + 1_000.0);
    assert_eq!(after_restart.fired, 0);
    assert_eq!(after_restart.skipped_missed, 0);
    assert_eq!(history(&reopened, &automation_id).len(), 1);
}

#[test]
fn seconds_interval_fold_skips_later_half_and_preserves_boundary() {
    let boundary = utc_ms(2026, 10, 1, 7, 0);
    for (from, expected) in [
        (
            utc_ms(2026, 10, 1, 5, 59) + 58_000,
            vec![
                utc_ms(2026, 10, 1, 5, 59) + 59_000,
                boundary,
                boundary + 1_000,
            ],
        ),
        (
            utc_ms(2026, 10, 1, 6, 30) + 15_000,
            vec![boundary, boundary + 1_000, boundary + 2_000],
        ),
    ] {
        let preview = timezone::preview_fires_in_zone("* * * * * *", NY, from as f64, 3).unwrap();
        assert_eq!(preview.fires, expected);
        assert!(preview.skipped.is_empty());
    }
}
