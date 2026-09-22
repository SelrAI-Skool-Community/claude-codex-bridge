# ADR-0003: Ownership by receipt, a separate baseline, and three-way reconciliation

Status: accepted for CORE-493, 22 September 2026.

A file is bridge-owned only when its path and hash are in a committed receipt
or in a pending intent recorded before the write. Identical bytes never prove
ownership. A copy the plan found byte-equal on the other provider is adopted
through a recorded intent for every file, the same proof an interrupted write
carries.

Each shared skill has a canonical copy in the portable core and an ordinary
directory in each provider's skill root. The receipt keeps, per copy, the
owned-file hashes, and beside the core copy a **baseline**: the last reconciled
content, recorded only after every copy is written. Reconciliation compares
the baseline with the current Claude and Codex copies. For that comparison a
file that matches its own receipt or a pending intent is the bridge's own
unfinished work and counts as the baseline, so an interrupted promotion resumes
from the side that still differs.

Decisions: unchanged; promote (one side changed, including a deletion against
an unchanged copy); accept-both (equal changes on both providers); conflict
(different changes, delete-versus-edit, an independently changed core copy, or
an unowned collision). A conflict writes nothing until the user chooses Claude,
Codex, the portable version, a merged result (edit one copy, then choose it),
or keeping the skill provider-specific. Every replaced candidate is preserved
under `~/.selr/bridge/conflicts/<skill>/` first.

## Rejected alternatives

| Rejected | Why |
| --- | --- |
| The core receipt as the baseline | It advances as soon as the core copy is written, so a run killed before the providers were written showed nothing left to promote. |
| Last-write-wins on the newest mtime | Timestamps are not intent; the spec forbids silent overwrites. |
