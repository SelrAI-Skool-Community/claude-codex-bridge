# ADR-0001: Extract the bridge from the Workshop Kit at a pinned revision

Status: accepted for CORE-493, 22 September 2026.

The bridge is a standalone product, not a Workshop mode. Its file safety,
atomic writer, operation lock, pending-intent receipt, skill ownership,
customisation preservation, shared knowledge helper, provider addition and
removal, and interrupted-run recovery are ported from
`claude-workshop-kit` revision `563a8746d4d1d4e0b6e0e59dfd80eb257728a47e`.
The secret scrubber and portability checker are vendored byte-for-byte from
Claude Sync revision `5aa59e30391f7a5ff070dd9378032493760cbc4d`.

`docs/lineage.json` records every port: upstream repository, revision,
original module, local module, and whether it is unchanged or adapted, with
the adaptations listed. `scripts/check-lineage.mjs` and `tests/lineage.test.mjs`
enforce the unchanged entries by checksum. A ported rule is changed only with
a documented reason in the module header and the lineage entry.

Excluded on purpose: onboarding, the active/cold skill library, connection
provisioning, classroom content, legacy Workshop migration, and Claude Sync's
GitHub team, invitation and cross-machine features.

## Rejected alternatives

| Rejected | Why |
| --- | --- |
| Add a bridge mode to the Workshop Kit | A different audience and lifecycle; the Workshop's onboarding and library would ride along. |
| Rewrite the safety layer for the bridge | The Workshop code has fixture, recovery and release evidence behind it; a rewrite would have none. |
