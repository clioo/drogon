# Native check pagination review

Root independently reproduced two protocol failures on 2026-09-07:
inspection responses could return `nextCursor`, but `CheckParams` discarded
the corresponding input; consuming checks also silently accepted pagination.
The real `orchestration_wire_review` binary initially passed 2 cases and failed
the 2 new assertions (lost cursor, accepted unread pagination).

`CheckParams` now has optional `cursor` and `limit`, permitted only for
non-consuming `peek`/`all` inspections. A consuming check always retains its
whole FIFO batch. Omitted fields preserve existing request shapes.

Independent verification: all 31 protocol cases pass (4 envelope, 7 scope,
16 wire, 4 review), and locked/offline all-target protocol clippy passes with
warnings denied. This is a wire correction, not mailbox implementation or
parity closure. The CLI must expose inspection pagination after integration;
the full native capability remains unadvertised until its runtime is accepted.
