//! Exact numeric ask budgets from the reference timer-delay/orchestration-ask-timeout.
//! MIT Copyright (c) 2026 Lovecast Inc.

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
use drogon_protocol::orchestration_question::MAX_ASK_TIMEOUT_MS;

/// Parse the exact integer, not a rounded float (600000.000000000000001 is invalid).
/// Bound lengths before multiplying so extreme exponents never allocate huge integers.
pub(crate) fn ask_timeout(raw: &str) -> Result<u32, String> {
    let value = exact_positive_integer(raw.trim())
        .filter(|value| *value > 0 && *value <= MAX_SAFE_INTEGER)
        .ok_or_else(|| format!("Invalid positive safe integer for --timeout-ms: {raw}"))?;
    Ok(value.min(u64::from(MAX_ASK_TIMEOUT_MS)) as u32)
}

fn exact_positive_integer(raw: &str) -> Option<u64> {
    for (lower, upper, radix) in [("0x", "0X", 16), ("0b", "0B", 2), ("0o", "0O", 8)] {
        if let Some(digits) = raw.strip_prefix(lower).or_else(|| raw.strip_prefix(upper)) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return None;
            }
            return u64::from_str_radix(digits, radix).ok();
        }
    }
    let raw = raw.strip_prefix('+').unwrap_or(raw);
    let mut parts = raw.split(['e', 'E']);
    let mantissa = parts.next()?;
    let exponent = match parts.next() {
        Some(text) => {
            let digits = text.strip_prefix(['+', '-']).unwrap_or(text);
            if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            text.parse::<i64>().ok()?
        }
        None => 0,
    };
    if parts.next().is_some() {
        return None;
    }
    let mut decimal = mantissa.split('.');
    let whole = decimal.next()?;
    let fraction = decimal.next().unwrap_or("");
    if decimal.next().is_some()
        || (whole.is_empty() && fraction.is_empty())
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let digits = format!("{whole}{fraction}");
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() {
        return None;
    }
    let shift = exponent.checked_sub(i64::try_from(fraction.len()).ok()?)?;
    if shift >= 0 {
        let shift = u32::try_from(shift).ok()?;
        if digits.len().checked_add(shift as usize)? > 16 {
            return None;
        }
        digits
            .parse::<u64>()
            .ok()?
            .checked_mul(10u64.checked_pow(shift)?)
    } else {
        let removed = usize::try_from(shift.checked_neg()?).ok()?;
        let end = digits.len().checked_sub(removed)?;
        if !digits.as_bytes()[end..].iter().all(|b| *b == b'0') {
            return None;
        }
        digits[..end].parse::<u64>().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_numeric_forms_are_exact_and_clamped_after_validation() {
        for (raw, expected) in [
            ("1000", 1000),
            ("1000.0", 1000),
            ("1e3", 1000),
            ("+1E+3", 1000),
            (".1e4", 1000),
            ("10000e-1", 1000),
            (" 1000 ", 1000),
            ("0x3e8", 1000),
            ("0b1111101000", 1000),
            ("0o1750", 1000),
            ("1800000", 1800000),
            ("1800001", 1800000),
            ("9007199254740991", 1800000),
            ("9.007199254740991e15", 1800000),
        ] {
            assert_eq!(ask_timeout(raw).unwrap(), expected, "{raw}");
        }
    }
    #[test]
    fn rounding_unsafe_integers_and_nonpositive_values_are_refused() {
        for raw in [
            "",
            " ",
            "0",
            "-1",
            "-1.0",
            "0.5",
            "NaN",
            "Infinity",
            "1e1000000000",
            "9007199254740992",
            "9007199254740991.1",
            "600000.000000000000001",
            "1e",
            "1e1e1",
            "1.1.1",
            "++1",
            "+0x10",
            "0x",
            "0b2",
            "1_000",
            ".",
            "-0",
            "1e-999999999",
        ] {
            assert!(ask_timeout(raw).is_err(), "{raw}");
        }
    }
}
