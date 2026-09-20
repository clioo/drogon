// Shared setup: runs in every worker before any test file. Order
// inoculation for the daemon-capabilities ↔ bots-mount product import cycle
// (daemon-capabilities → bots-mount → bots-panel-descriptor → BotsPanel →
// use-bots-page-controller → bot-session-open → daemon-capabilities).
// REQUIRED_DAEMON_CAPABILITIES reads BOTS_CAPABILITY at module-evaluation
// time, so whichever file enters the cycle first in a worker fixes the
// array: entering anywhere but daemon-capabilities itself freezes
// `undefined` into the shared registry (no TDZ under the SSR transform)
// and every later file in that worker sees
// `['agent.settings.v1', undefined]`. With `isolate: false` workers are
// shared and file order follows the size/cache sequencer, so the suite
// fails unsharded and passes sharded by luck. Evaluating the safe entry
// here makes every worker order-independent. The cycle itself lives in
// product source; breaking it is a separate follow-up.
import "./src/renderer/src/daemon-capabilities";
