//! IANA-timezone schedule evaluation for automations.
//!
//! Every automation stores its cron wall time plus an IANA zone in
//! [`Automation::timezone`](super::records::Automation::timezone); rows
//! stored without a zone (including every row written before zones
//! existed) evaluate in UTC, bit-identical to the historical tick. The
//! renderer builds the same policy on the host Intl database
//! (`automation-cron-preview.ts`), so editor previews and this backend
//! agree fire-for-fire.
//!
//! ## Policy (frozen)
//!
//! * Absent/blank zone means UTC. An invalid IANA name is rejected at
//!   admission, never silently treated as UTC.
//! * Cron evaluation runs in the stored zone via `croner` over
//!   `chrono::DateTime<Tz>` (the same pairing `croner` itself pins in its
//!   dev-dependencies: `chrono-tz 0.10`). No handwritten tz database.
//! * A fixed-time slot (single minute and hour, like croner's `FixedTime`)
//!   whose local wall time falls in a DST gap is **recorded skipped**,
//!   never shifted: [`next_fire_in_zone`] reports the skip alongside the
//!   next real fire, and the tick writes one `SkippedMissed` row for it.
//!   Interval/step/list schedules simply have no fire inside the gap, on
//!   both sides.
//! * A repeated local slot (fall-back fold) fires once, at its first
//!   occurrence: `croner` yields the earlier instant for fixed-time jobs,
//!   and the strictly-after reschedule from it advances past the later
//!   half (covered by `automation_timezone.rs`).
//! * Missed-run grace and no-catch-up-storm behavior are unchanged: a gap
//!   skip is one row per skipped slot, and ordinary missed slots keep the
//!   existing grace path.
//!
//! Intra-day gaps (every real DST transition) are detected by wall-clock
//! mismatch against the pinned time. A hypothetical whole-day skip
//! (Samoa-2011 class) advances silently like an interval gap; documenting
//! rather than special-casing it.
//!
//! The stored `next_run_at` is always the `croner`-native instant (the
//! first valid instant at/after the gap), so the gap verdict is
//! recomputed identically after a restart, and a retried tick upserts
//! the same stable run id.

use std::str::FromStr;

use chrono::{DateTime, Datelike, LocalResult, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use croner::Cron;

/// The legacy zone: rows stored without a zone evaluate here.
pub const UTC_TIMEZONE: &str = "UTC";

/// IANA names are short (`America/Argentina/ComodRivadavia` is the
/// longest at 32 bytes); this cap rejects pasted documents, not zones.
pub const TIMEZONE_MAX_BYTES: usize = 64;

/// Upper bound on gap-skip hops per fire computation. Real transitions
/// skip at most one slot per computation; the bound only stops a
/// pathological loop, never a legitimate schedule.
const MAX_GAP_HOPS: usize = 4;

/// Validates and canonicalizes a timezone param. `None`/blank means the
/// legacy UTC behavior. `"UTC"` passes through. Anything else must parse
/// as an IANA name in the bundled database; invalid names are rejected,
/// never coerced to UTC. Returns the canonical zone name to store.
pub fn normalize_timezone(raw: Option<&str>) -> Result<String, String> {
    let trimmed = raw.unwrap_or("").trim();
    if trimmed.is_empty() || trimmed == UTC_TIMEZONE {
        return Ok(UTC_TIMEZONE.to_string());
    }
    if trimmed.len() > TIMEZONE_MAX_BYTES {
        return Err(format!(
            "timezone must be at most {TIMEZONE_MAX_BYTES} bytes"
        ));
    }
    if trimmed.bytes().any(|b| b.is_ascii_control()) {
        return Err("timezone must not contain control characters".to_string());
    }
    let tz: Tz = trimmed
        .parse()
        .map_err(|_| format!("unknown timezone: {trimmed}"))?;
    Ok(tz.name().to_string())
}

/// Resolves an already-normalized zone: `None` is UTC.
fn resolve_zone(timezone: &str) -> Result<Option<Tz>, String> {
    if timezone.is_empty() || timezone == UTC_TIMEZONE {
        return Ok(None);
    }
    Tz::from_str(timezone)
        .map(Some)
        .map_err(|_| format!("unknown timezone: {timezone}"))
}

/// A single minute+hour pinned by a cron expression (both fields one
/// literal value, no wildcard/step/list/range). Mirrors croner's
/// `FixedTime` (single minute and hour) closely enough for gap policy:
/// anything ambiguous is treated as interval and never skip-recorded.
struct PinnedWall {
    minute: u32,
    hour: u32,
}

fn single_field(field: &str, min: u32, max: u32) -> Option<u32> {
    if field
        .bytes()
        .any(|b| matches!(b, b'*' | b'/' | b',' | b'-'))
    {
        return None;
    }
    let value: u32 = field.parse().ok()?;
    (min <= value && value <= max).then_some(value)
}

fn pinned_wall_time(cron_expr: &str) -> Option<PinnedWall> {
    // Five-field (minute hour dom month dow) and six-field (leading
    // seconds, which croner also admits) schedules; anything else is not
    // a fixed wall time.
    let fields: Vec<&str> = cron_expr.split_whitespace().collect();
    let (minute, hour) = match fields.len() {
        5 => (fields[0], fields[1]),
        6 => (fields[1], fields[2]),
        _ => return None,
    };
    Some(PinnedWall {
        minute: single_field(minute, 0, 59)?,
        hour: single_field(hour, 0, 23)?,
    })
}

/// One fixed-time slot with no fire: its local wall time does not exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GapSkip {
    /// Local calendar date with no fire, e.g. `"2026-03-08"`.
    pub local_date: String,
    /// Local wall time that does not exist, e.g. `"02:30"`.
    pub wall_time: String,
    pub reason: String,
}

fn gap_skip(tz: Tz, date: chrono::NaiveDate, pinned: &PinnedWall) -> GapSkip {
    // Manual calendar rendering: chrono's `DelayedFormat` Display needs
    // the `alloc` feature, which the locked chrono build does not enable
    // (and nothing else here needs it).
    let local_date = format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day());
    let wall_time = format!("{:02}:{:02}", pinned.hour, pinned.minute);
    GapSkip {
        reason: format!(
            "No {wall_time} on {local_date} in {} (DST gap); recorded skipped.",
            tz.name()
        ),
        local_date,
        wall_time,
    }
}

/// Next fire plus the gap skips advanced past to reach it. Preview-only:
/// storage always keeps the native instant (see [`next_native_fire_ms`])
/// so a gap slot is still on record when the tick reaches it.
pub fn next_native_fire_ms(cron_expr: &str, timezone: &str, after_ms: f64) -> Option<i64> {
    let zone = resolve_zone(timezone).ok()?;
    let Some(tz) = zone else {
        return super::scheduler::next_fire_ms(cron_expr, after_ms);
    };
    let cron = Cron::from_str(cron_expr.trim()).ok()?;
    let after_secs = (after_ms / 1000.0).floor() as i64;
    let start = DateTime::<Utc>::from_timestamp(after_secs, 0)?;
    let fire = cron
        .find_next_occurrence(&start.with_timezone(&tz), false)
        .ok()?;
    Some(fire.timestamp_millis())
}

/// Next fire plus the gap skips advanced past to reach it. Preview-only:
/// storage always keeps the native instant (see [`next_native_fire_ms`])
/// so a gap slot is still on record when the tick reaches it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZonedFire {
    pub fire_utc_ms: i64,
    pub skipped: Vec<GapSkip>,
}

pub fn next_fire_in_zone(cron_expr: &str, timezone: &str, after_ms: f64) -> Option<ZonedFire> {
    // Normalized-zone sanity: callers pass admission-checked zones; a
    // zone that stopped resolving fails closed with no fire.
    resolve_zone(timezone).ok()?;
    let mut skipped = Vec::new();
    let mut after = after_ms;
    for _ in 0..MAX_GAP_HOPS {
        let fire = next_native_fire_ms(cron_expr, timezone, after)?;
        let Some(skip) = gap_skip_for_slot(cron_expr, timezone, fire as f64) else {
            return Some(ZonedFire {
                fire_utc_ms: fire,
                skipped,
            });
        };
        skipped.push(skip);
        after = fire as f64;
    }
    None
}

/// Authoritative preview: next `count` fires plus gap skips, with the
/// tick's exact semantics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZonedPreview {
    pub timezone: String,
    pub fires: Vec<i64>,
    pub skipped: Vec<GapSkip>,
}

pub fn preview_fires_in_zone(
    cron_expr: &str,
    timezone: &str,
    from_ms: f64,
    count: usize,
) -> Option<ZonedPreview> {
    if count == 0 {
        return None;
    }
    let mut fires = Vec::new();
    let mut skipped = Vec::new();
    let mut after_ms = from_ms;
    for _ in 0..count {
        let next = next_fire_in_zone(cron_expr, timezone, after_ms)?;
        skipped.extend(next.skipped);
        fires.push(next.fire_utc_ms);
        after_ms = next.fire_utc_ms as f64;
    }
    Some(ZonedPreview {
        timezone: timezone.to_string(),
        fires,
        skipped,
    })
}

/// The gap skip for a native fire instant, or `None` when the slot is a
/// real fire (matching wall time, interval schedule, UTC zone, or a
/// mismatch that still resolves). Shared by the tick verdict and the
/// preview loop so both agree slot-for-slot.
pub fn gap_skip_for_slot(cron_expr: &str, timezone: &str, slot_ms: f64) -> Option<GapSkip> {
    let pinned = pinned_wall_time(cron_expr)?;
    if timezone.is_empty() || timezone == UTC_TIMEZONE {
        return None;
    }
    let tz = resolve_zone(timezone).ok()??;
    let slot_secs = (slot_ms / 1000.0).floor() as i64;
    let slot_utc = DateTime::<Utc>::from_timestamp(slot_secs, 0)?;
    let local = slot_utc.with_timezone(&tz).naive_local();
    if local.hour() == pinned.hour && local.minute() == pinned.minute {
        return None;
    }
    let date = local.date();
    let pinned_naive = date.and_hms_opt(pinned.hour, pinned.minute, 0)?;
    if !matches!(tz.from_local_datetime(&pinned_naive), LocalResult::None) {
        return None;
    }
    Some(gap_skip(tz, date, &pinned))
}

/// True when `slot_ms` is a gap-shift artifact: a fixed-time cron whose
/// pinned wall time does not exist on the slot's local date. The tick
/// uses this to record the slot skipped instead of dispatching it, so a
/// restart between scheduling and firing reaches the same verdict.
pub fn is_gap_slot(cron_expr: &str, timezone: &str, slot_ms: f64) -> bool {
    gap_skip_for_slot(cron_expr, timezone, slot_ms).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_and_blank_zones_mean_utc() {
        assert_eq!(normalize_timezone(None).unwrap(), "UTC");
        assert_eq!(normalize_timezone(Some("")).unwrap(), "UTC");
        assert_eq!(normalize_timezone(Some("  ")).unwrap(), "UTC");
        assert_eq!(normalize_timezone(Some("UTC")).unwrap(), "UTC");
    }

    #[test]
    fn invalid_zones_reject_instead_of_coercing() {
        assert!(normalize_timezone(Some("Mars/Olympus")).is_err());
        assert!(normalize_timezone(Some("EST5EDT,M3.2.0/2,M11.1.0/2")).is_err());
    }
}
