# Source notice corpus closure

ROOT accepted the exact `.preflight/nr1-notice-corpus.json` blob from V5
`17dae1b0bcf712fda9114d2a2d9cbf4c2e9e2104`, incorporating the acquired
`99ee4ae` corpus and the reviewed excerpt/full-source metadata corrections.
All 22 UTF-8 byte lengths and SHA-256 hashes were independently recomputed
from their stored text on 2026-09-07; zero mismatches, zero incomplete entries.
The current fail-closed verifier test suite passed 24/24 on pinned Node24.

This accepts a source-notice input corpus, not full packaged-runtime inventory
or legal clearance. The expected-notices manifest/generator/package gate were
not changed. Existing held entries and E5 rights/recordings/services decisions
remain separate. No network reacquisition, artwork/font binary publication,
installation, provider call or license substitution occurred in this integration.

The first three entries explicitly distinguish excerpt bytes/hashes from the
full upstream files. Font-logos README provenance names the actual README
fields, not license fields or an invented readme byte-count field. Preserve
these distinctions when implementing the remaining generator/inventory work.
