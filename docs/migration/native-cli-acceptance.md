# Native CLI acceptance gate

`node scripts/accept-core-cli.mjs --coordination` extends the existing isolated
daemon/CLI acceptance harness. It uses the real typed commands, no mock server,
agent inference or user data. It requires run/task creation and cross-process
replay, literal instruction preservation, actor-scoped saved/absent receipts,
and non-consuming empty mail inspection. Worker launch and settlement require
the separate real-PTY and authenticated-mail integration suites.

The first compiled run on 2026-09-07 failed at `run-create` with
`method_not_found`: the service deliberately does not advertise the complete
native capability before mail wiring is accepted. Seven earlier shell/protocol
checks passed; owned service cleanup observed `exited`. This is a recorded
integration RED, not completed coordination acceptance. Do not enable the
capability merely to satisfy this probe; all promised methods must first work.

Report: `.preflight/acceptance/core-cli-1788772500730-c05b719c-f631-4969-a592-26eeb477941d.json`.
