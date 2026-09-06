# Bot form and Settings visual reference

Second successful reference run, same frozen source and guarded visual build
as [the first capture](../c9790628-light-empty/README.md). macOS, light theme,
1440 × 1000 viewport, new synthetic profile. These are **legacy reference**
screens, not the rewrite. The exact historical [result.json](result.json)
contains each PNG hash, runner digest, profile paths and observed listeners.

- [Minimal Bot form](04-bot-create-minimal-light.png): selected Tyrion;
  independently asserted radio selection, blank optional name and
  `Tyrion Lannister` placeholder. No Bot was submitted or persisted.
- [Expanded character catalog](05-bot-character-catalog-light.png): asserted
  17 radio choices after clicking All characters. The hover highlight is
  pointer state, not a second selection.
- [Advanced controls](06-bot-advanced-light.png): actual Agent selector;
  lower controls extend below this viewport and are not fully captured.
- [Settings, General](07-settings-light.png): actual sidebar entry and
  rendered navigation/workspace controls in the isolated profile.

The coordinator visually inspected those four new states. The run also
recaptured initial, Bots-empty and Meetings-empty pages; all seven PNGs are
retained. Status-bar memory values and hover state can differ between runs;
their pixel hashes are provenance, not a pixel-equivalence assertion.

The form was cancelled. No agent, cron, external event adapter, model request,
Mentu execution, or new Bot session was launched. Agent detection listing
an option and an enabled submit button do not prove that harness works.
The application closed normally. The fresh user profile and source copy
were retained; no personal application or settings were modified.
