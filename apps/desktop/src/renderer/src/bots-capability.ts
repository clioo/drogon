// MIT Copyright (c) 2026 Lovecast Inc.
// Leaf owner of the Bots capability id for daemon-capabilities.ts. The id
// (`bot.snapshot.v1`, advertised by the service in
// crates/drogon-core/src/lib.rs's CAPABILITIES list) also stays declared in
// bots-mount.ts, whose comments require it to remain a module-local
// constant there — and daemon-capabilities.ts importing it from that heavy
// module closed a product import cycle (daemon-capabilities → bots-mount →
// bots-panel-descriptor → BotsPanel → use-bots-page-controller →
// bot-session-open → daemon-capabilities) in which
// REQUIRED_DAEMON_CAPABILITIES read BOTS_CAPABILITY at module-evaluation
// time. Entering the cycle anywhere but daemon-capabilities itself froze
// `undefined` into `['agent.settings.v1', undefined]`. This module has no
// imports of its own, so importing the id from here breaks the cycle at
// its root; every existing `bots-mount` import path keeps working
// untouched. The duplication is deliberate and pinned: the
// bots-first test in daemon-capabilities.test.ts asserts this leaf and
// bots-mount agree, so the two copies can never drift silently.

/** The capability id the live service advertises for the Bots panel. */
export const BOTS_CAPABILITY = "bot.snapshot.v1";
