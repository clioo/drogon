# Speech catalog — original G15 registry checkpoint

Static source at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`, owner **WP-CAP-DEVICE**,
with UI-SETTINGS/MOBILE/SHARED consumers. Companion JSON preserves literal model
metadata, immutable download revisions, declared file hashes and eight source hashes.
All eight source files were checked against pinned Git blobs. No source module was
imported or executed; AST literals were decoded with the existing restricted
`staticBindings` reader. Download helper calls were recorded, not invoked.

| Original model ID | Provider | Language | Streaming | Download files |
|---|---|---|---|---:|
| `parakeet-tdt-0.6b-v3-int8` | local | multilingual | no | 4 |
| `parakeet-tdt-0.6b-v2-int8` | local | en | no | 4 |
| `zipformer-bilingual-zh-en` | local | zh-en | yes | 5 |
| `paraformer-bilingual-zh-en` | local | zh-en | yes | 3 |
| `zipformer-streaming-en-20m` | local | en | yes | 4 |
| `zipformer-streaming-zh-14m` | local | zh | yes | 4 |
| `zipformer-streaming-korean` | local | ko | yes | 4 |
| `parakeet-tdt-ctc-0.6b-ja-int8` | local | ja | no | 2 |
| `whisper-tiny` | local | multilingual | no | 3 |
| `sense-voice-zh-en-ja-ko-yue` | local | multilingual | no | 2 |
| `openai-gpt-4o-mini-transcribe` | openai | multilingual | no | — |
| `openai-gpt-4o-transcribe` | openai | multilingual | no | — |

**12 built-in models:10 local,2 cloud,5 streaming,1 recommended** (Parakeet v3).
Every catalog row has sampleRate16000. Ten local download records name35 files
with source-declared sizes/SHA256 and40-character repository revisions. Their
contents were not downloaded or verified. Source descriptions are not independent
accuracy claims. Existing MIT provenance remains recorded.

## Bounded observable behavior read

The default voice configuration is disabled, with empty model/model directory,
language en, toggle mode, no user models/key/microphone selection
(`shared/constants.ts:180-193`). Recommended does not mean selected by default.

`VoiceSpeechModelSection.tsx` was read fully: disabled voice prevents opening the
selector; download/extract disables that item; ready selection changes the model;
nonready cloud opens credentials; local download keeps the menu open and reports
errors. It shows active/ready, progress, recommended and size cues. Ready local
models can be deleted with per-model pending UI and refresh/error handling.

`runtime-mobile-speech-catalog.ts` was read fully: it projects all models and
settings, validates model identity for configure/download, but configure does not
require readiness. Download returning started:true is **not download completion**;
subsequent failure is logged. Delete delegates cleanup to another service.

`model-manager.ts` was read only through105: reads await cache migration; active
download/extract state remains cached; unknown ID is error; cloud ready state uses
API-key presence. Local readiness, download/recovery/native loader internals remain
outside this slice. No credential was read and no model was invoked.

## Test and closure boundaries

Five tests in `main/speech/model-catalog.test.ts` were read: Japanese manifest,
unique IDs, SenseVoice classification/layout/pinned files. **None executed.**
Original file allocation places these under WP-CAP-DEVICE; no new package invented.

G15's built-in model **registry** is now explicit; full voice experience remains
an execution/UI/native/download obligation. Types include custom userModels, which
are not a second built-in registry established by this artifact. Do not infer
unsupported custom behavior merely from this bounded trace. Cloud entries are
product parity requirements, not permission to use cloud inference for the
separate Pi+Spark-only benchmark. No app or installed build was changed.
