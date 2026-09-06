// Generates bounded, source-executed locale-ordering fixtures.
//
// This does NOT read the pinned reference checkout at all: the behavior
// under test is `String.prototype.localeCompare()` itself (a JS engine
// builtin), which is exactly what
// src/main/persistence/loading-store/bot-persistence.ts:47 calls with no
// explicit locale/options argument. Running it here, from the rewrite repo's
// own cwd, with Node24, reproduces the real source behavior without ever
// using the reference checkout as cwd or reading any of its files.
//
// Node24 path (fixed, do not rediscover by scanning $HOME):
//   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node

const LOCALES = {
  default: undefined, // new Intl.Collator() with no locale -> resolves to host default (recorded below)
  'en-US': 'en-US',
  'es-MX': 'es-MX',
  sv: 'sv',
  tr: 'tr',
  de: 'de',
  ja: 'ja',
};

const CASES = {
  accent: ['cafe', 'café', 'cafz'],
  case: ['apple', 'Apple', 'APPLE', 'banana'],
  canonical_equivalent: ['éclair', 'éclair', 'eclair'], // "e"+combining acute vs precomposed é vs plain e
  punctuation: ['A-B', 'AB', 'A B', 'A.B'],
  numeric_substring: ['item2', 'item10', 'item1'],
  non_latin: ['日本語', 'カタカナ', 'English', 'Анна', 'Борис'],
  // equal_name_ties is NOT a CASES entry: that case needs distinguishable
  // per-item identity while comparing a shared name field, so it is built
  // from `tieItems` below, not from this string-only CASES map.
};

function sortNames(names, locale) {
  const collator = locale === undefined ? new Intl.Collator() : new Intl.Collator(locale);
  return [...names].sort((a, b) => a.localeCompare(b, locale));
}

// For the equal-name tie case we need distinguishable original identity while
// comparing only on a shared "name" field, to prove *stable* (insertion-order-preserving) sort.
const tieItems = [
  { tag: 'first', name: 'dup' },
  { tag: 'second', name: 'dup' },
  { tag: 'third', name: 'dup' },
  { tag: 'fourth-distinct', name: 'zzz' },
];

const out = { resolvedDefaultLocale: new Intl.Collator().resolvedOptions().locale, nodeVersion: process.version, icuVersion: process.versions.icu, cases: {} };

for (const [caseName, names] of Object.entries(CASES)) {
  if (caseName === 'equal_name_ties') continue;
  out.cases[caseName] = {};
  for (const [label, locale] of Object.entries(LOCALES)) {
    out.cases[caseName][label] = sortNames(names, locale);
  }
}

out.cases.equal_name_ties = {};
for (const [label, locale] of Object.entries(LOCALES)) {
  const collator = locale === undefined ? undefined : locale;
  const sorted = [...tieItems].sort((a, b) => a.name.localeCompare(b.name, collator));
  out.cases.equal_name_ties[label] = sorted.map((i) => i.tag);
}

// Pairwise raw comparison signs (useful for direct Rust Ordering assertions).
out.pairwise = {};
const PAIRS = [
  ['cafe', 'café'],
  ['apple', 'Apple'],
  ['item2', 'item10'],
  ['dup', 'dup'],
  ['éclair', 'éclair'],
];
for (const [label, locale] of Object.entries(LOCALES)) {
  out.pairwise[label] = PAIRS.map(([a, b]) => ({ a, b, sign: Math.sign(a.localeCompare(b, locale)) }));
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
