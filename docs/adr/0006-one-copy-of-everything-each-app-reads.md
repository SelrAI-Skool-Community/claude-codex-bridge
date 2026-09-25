# ADR-0006: One copy of everything each app reads

Status: accepted for CORE-493 ship work, 25 September 2026.

Real-setup testing found two ways a bridged machine ended up with two copies
of the same thing, which drift apart.

**Seeded instructions move.** When the portable instructions are seeded from
a provider's global instructions, that text moves: the provider file keeps
only the bridge block, and the receipt records `movedInstructions`. Both apps
then read one copy, so an edit to the portable instructions can never
contradict a stale copy in `CLAUDE.md` or `AGENTS.md`. Removing a provider or
uninstalling writes the current portable text back into the file it came
from. A provider file whose text differs from the seed keeps it and is
reported as app-specific. `--keep-provider-instructions` copies instead.
The knowledge contract routes "change how you work" requests to the portable
file, and "for this app only" to the overlay.

**Codex skills live in one folder.** Codex 0.155 loads skills from both
`$CODEX_HOME/skills` and `~/.agents/skills` (verified with a live session).
The bridge manages `~/.agents/skills`. A skill in Codex's own folder that is
shared is moved into the managed folder first, with intents recorded like
every other write, so Codex never loads it twice. An identical copy already
in both folders has the old one retired; different copies are reported and
left alone.

Claude Code 2.1.276 loads skills only from `$CLAUDE_CONFIG_DIR/skills`
(verified the same way), which is the Claude skill root the bridge manages.

## Rejected alternatives

| Rejected | Why |
| --- | --- |
| Copy the seeded text and leave the original | Tested against a real setup: the first portable edit leaves Claude reading two contradicting instructions. |
| Manage both Codex skill folders | Two owned copies of one skill in one app is the duplication this ADR removes. |
