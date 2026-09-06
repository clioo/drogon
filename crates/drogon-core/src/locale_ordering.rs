//! Real ICU4X-backed locale-aware string comparator, ported to replace the
//! source's default `String.prototype.localeCompare()`
//! (`left.displayIdentity.displayName.localeCompare(right.displayIdentity.displayName)`,
//! confirmed directly against the pinned source at
//! `src/main/persistence/loading-store/bot-persistence.ts:47`, revision
//! `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, sha256
//! `0b62fc7b3c494b7566c1f4b2252f38b5adb864ac5a61e3be5a5ac8fd8cc62909`). See
//! `docs/migration/native-locale-ordering.md`.
//!
//! This module accepts an **explicit** caller-supplied BCP-47 locale tag; it
//! never picks a default locale itself (root owns host-default-locale
//! discovery/binding -- see the doc's "Root owns public registration and
//! host-default-locale initialization"). An invalid locale tag or missing
//! collation data is a returned [`LocaleOrderingError`], never a panic and
//! never a silent fall-through to binary/byte-order sorting.
//!
//! The source called `localeCompare()` with no explicit locale/options
//! argument, i.e. the JS engine's own default sensitivity/numeric/case-first
//! behavior for whatever locale it resolves. This build cannot reproduce
//! "whichever locale the JS engine defaults to" without root's host-locale
//! binding, so [`compare`] takes the locale explicitly and otherwise mirrors
//! the source's *lack* of explicit options: it uses
//! [`icu_collator::options::CollatorOptions::default()`] un-tweaked, and does
//! not force numeric ordering, case-insensitivity, accent-insensitivity, or a
//! non-default (e.g. primary-only) strength, matching the doc's explicit
//! instruction not to "turn on numeric sorting, ignore case/accents or
//! choose a primary-only strength without source evidence."
//!
//! `Vec::sort_by`/`slice::sort_by` (stable sort) must be used with
//! [`compare`], never `sort_unstable_by`: the source relies on
//! `Array.prototype.sort`'s spec-mandated stability to preserve original
//! (insertion) order for names the collator considers equal.

use std::cmp::Ordering;
use std::str::FromStr;

use icu_collator::{Collator, CollatorBorrowed, options::CollatorOptions};
use icu_locale::Locale;

#[derive(Debug)]
pub enum LocaleOrderingError {
    /// `locale_tag` is not a syntactically valid BCP-47 language tag.
    InvalidLocale { requested: String, detail: String },
    /// The tag parsed, but no ICU4X collation data is compiled in for it
    /// (falls back to root data only if the requested locale has none of
    /// its own -- this variant is for the rare case even root fails).
    CollationDataUnavailable { requested: String, detail: String },
}

impl std::fmt::Display for LocaleOrderingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidLocale { requested, detail } => {
                write!(f, "invalid locale tag {requested:?}: {detail}")
            }
            Self::CollationDataUnavailable { requested, detail } => {
                write!(f, "no collation data for locale {requested:?}: {detail}")
            }
        }
    }
}

impl std::error::Error for LocaleOrderingError {}

/// A comparator bound to one validated locale. Construct with
/// [`DisplayNameComparator::for_locale`]; reuse it across an entire sort
/// rather than re-parsing the locale/re-building the collator per pair.
#[derive(Debug)]
pub struct DisplayNameComparator {
    locale_tag: String,
    collator: CollatorBorrowed<'static>,
}

impl DisplayNameComparator {
    /// Validates `locale_tag` as a BCP-47 tag and builds a real ICU4X
    /// collator for it from compiled-in data. Returns an error rather than
    /// panicking or silently substituting a different locale/binary order.
    pub fn for_locale(locale_tag: &str) -> Result<Self, LocaleOrderingError> {
        let locale =
            Locale::from_str(locale_tag).map_err(|e| LocaleOrderingError::InvalidLocale {
                requested: locale_tag.to_string(),
                detail: e.to_string(),
            })?;
        let collator =
            Collator::try_new(locale.into(), CollatorOptions::default()).map_err(|e| {
                LocaleOrderingError::CollationDataUnavailable {
                    requested: locale_tag.to_string(),
                    detail: e.to_string(),
                }
            })?;
        Ok(Self {
            locale_tag: locale_tag.to_string(),
            collator,
        })
    }

    pub fn locale_tag(&self) -> &str {
        &self.locale_tag
    }

    /// Culturally-relevant comparison of `left`/`right`, mirroring the
    /// source's `left.localeCompare(right)` (module doc). Names the
    /// collator considers equal return [`Ordering::Equal`]; pair this with
    /// a *stable* sort to preserve insertion order for those ties (module
    /// doc).
    pub fn compare(&self, left: &str, right: &str) -> Ordering {
        self.collator.compare(left, right)
    }
}

/// Sorts `items` in place by `display_name(item)` under `locale_tag`,
/// preserving the source's stable-tie behavior (module doc). This is the
/// primitive `bots::storage::list_bots` should call once root binds a
/// host locale; it does not choose a default locale itself.
pub fn sort_by_display_name_stable<T>(
    items: &mut [T],
    locale_tag: &str,
    display_name: impl Fn(&T) -> &str,
) -> Result<(), LocaleOrderingError> {
    let comparator = DisplayNameComparator::for_locale(locale_tag)?;
    items.sort_by(|a, b| comparator.compare(display_name(a), display_name(b)));
    Ok(())
}
