# E2 accepted source evidence archive

Root accepted the Settings/shortcuts source gate in `7c267a4`; the acceptance scope and independent samples are in `audit-root-followup-review.md`. This archive preserves the settled E2 artifacts, including earlier candidate claims superseded by that root decision. It does not grant implementation, runtime, rendered-UI or platform acceptance.

The source revision is `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. All paths below are under `audit-closure/e2-settings/`. JSON files parsed successfully at archival time. The producer scripts are preserved as provenance, not executed or newly certified by this archival check. Follow normal script review before rerunning them; they contain workstation-specific paths.

| Artifact | SHA-256 |
| --- | --- |
| build-closure.py | c21207d9b2b7db85c8bbfeddffcd17996da08d93166ade3b579a4b68599e6ea1 |
| build-shortcut-action-followup.py | b8638005d2559bb35af89f7671fa7ff69a94d6e48413b651d2ac5bc251a27c9d |
| closure.json | 549fdfa31f63d3aebd910838de79edfbe75d955163ef262fd5e2f895eb591ba5 |
| field-contracts.tsv | 0d497cba8b7307b95c44e42428c4a635dba1a5694bacf51b1e852a4a45e799a5 |
| followup-shortcut-actions.json | edd16291826c3b0e15e2b340dc30302530fbd8f797c7d1abdad372e1022cecf0 |
| followup-shortcut-actions.md | 85b8e5de7dfcd105834e024c8b888d25b12d6aa1874a8a058a6b42a523eaa71d |
| report.md | 38ffbcc26d5a8253b625144762962c2acc336dec2529dc05c0148f851d41de9a |
| shortcut-contracts.tsv | 54d0a1f4ba8a739f373769656e8c56f10407c258f91240eaf038e33c7fcaea5d |
| source-test-files.txt | 1a5d53a1a126ba6c1963b01d0170d20219bb164b50a9e5aa31ca350bc844b9c1 |
| source-test-plan.json | b6f7ed9a8ea01454f78e3b76c5a75ac77ae2a5bcccd45e0d38e429d4df34ba95 |

A bounded private-key/provider-token pattern scan found only `sk-` substrings inside source filenames beginning `use-task-`; those matches were inspected with token-like substrings redacted. This is a targeted hygiene check, not a comprehensive secret-detection guarantee. No credentials or provider transcripts were added by this archival operation.

The complete source-suite inventory and T1–T4 execution debts remain binding. Audit progress stays 8/12 (~67%): archiving an already accepted group is not a new group closure.
