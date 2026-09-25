# claude-codex-bridge

Zero-dependency Node kit; `package.json` carries the test, check, lineage and
journey scripts.

Before changing behaviour read `CONTEXT.md` (vocabulary) and the ADR in
`docs/adr/` that owns the area. Every mutation goes through
`inspect → plan → apply → verify` in `scripts/bridge-engine.mjs`: a new
external write records its intent in the receipt first and names a checkpoint
after the write, so `tests/recovery.test.mjs` exercises it automatically.

`scripts/scrub.mjs` and `scripts/portability.mjs` are vendored; change them
only by re-vendoring from Claude Sync and updating the pin in
`docs/lineage.json`. Ported Workshop modules keep their upstream rules; record
any adaptation in the same file and in the lineage manifest.

Text an agent reads (`skills/**`, `core/**`, `docs/start/setup.md`) follows the
`writing-for-agents` skill. Text a Skool member reads is plain English.

Issues live in Linear (Core Builds team).
