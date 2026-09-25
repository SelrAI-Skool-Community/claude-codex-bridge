# ADR-0002: One deterministic workflow, inspect → plan → apply → verify

Status: accepted for CORE-493, 22 September 2026.

The only behavioural seam is `scripts/bridge-engine.mjs`: `inspect` reads both
providers and the core; `plan` classifies every artefact into one disposition
and emits an immutable, content-addressed plan; `apply` performs exactly that
plan's operations; `verify` reads the result and reports evidence. The command
line and the `claude-codex-bridge` skill are thin layers over it, so Claude and
Codex cannot make different safety decisions from the same machine state.

Inspection and planning write nothing outside `~/.selr/bridge/plans`. A plan
records preconditions (hashes of every source it read) and apply refuses a
stale plan. Every apply runs under the owner-bearing operation lock and records
each write or removal in the receipt's `pending` section before touching disk;
`apply({ checkpoint })` names each boundary so the recovery tests can stop the
process there. A later `plan` + `apply` continues from the receipt.

Reports use fixed states: `confirmed`, `unknown`, `unsupported`, `blocked`,
`conflicted`, `failed`. An unread value is `unknown`, never absent.

## Rejected alternatives

| Rejected | Why |
| --- | --- |
| A fixed installer sequence like the Workshop's | The bridge's writes depend on what was found and what the user chose; a plan makes that explicit and approvable. |
| Apply without a saved plan | The user could not approve exactly what changes, and tests could not exercise the decision layer alone. |
