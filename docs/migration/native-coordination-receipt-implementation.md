# Actor-scoped receipt inspection

`orchestration.requestShow` reads the existing ledger without creating a read receipt.
Bootstrap identities, current coordinator generations and authenticated dispatches
use the same actor keys as mutations. Coordinator and worker fences are checked
in the read transaction before looking up either a saved or absent operation.
Absence is explicitly not evidence that an operation had no effects.

The projection distinguishes pending, committed, failed and absent records. Invalid
stored records produce a bounded error without echoing corrupt content. SQL bounds
each selected text field; the complete successful RPC envelope must fit 512 KiB.

Validation: six real Engine integration tests cover reopen durability, absence,
read-only behavior, stale takeover, actor/host separation, corrupt records and
response limits. Authenticated dispatch tests additionally refuse bootstrap and
sibling scopes. The complete-envelope boundary test failed behaviorally before
the response-size correction, then passed. These tests do not establish mail or
settled-worker recovery; those remain separate integration gates. Native capability
advertisement remains disabled until the combined contract is accepted.
