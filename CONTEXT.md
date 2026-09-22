# Domain context

The vocabulary the code, tests and docs use. One meaning per term.

- **Portable core**: provider-neutral managed content at `~/.selr/bridge/core`:
  portable instructions, shared skills, explicit knowledge, handoff snapshots,
  the knowledge contract and the MCP metadata inventory. Survives removal of
  either provider.
- **Provider adapter**: everything the engine knows about reading one provider
  (`scripts/bridge-adapters.mjs`). Adapters read; the engine writes.
- **Provider overlay**: a managed document read by one provider only
  (`core/overlays/<provider>.md`): model routing, permissions, provider
  behaviour. Never synchronised across providers.
- **Receipt**: `~/.selr/bridge/manifest.json`. Ownership evidence (per-file
  hashes for every bridge-owned file) and progress evidence (the `pending`
  section of intents recorded before each write or removal).
- **Baseline**: the last reconciled content of a shared skill, recorded beside
  the core copy's ownership hashes. The three-way comparison is baseline versus
  the current Claude copy versus the current Codex copy.
- **Disposition**: the one label every discovered artefact gets: `shared`,
  `claude-only`, `codex-only`, `translated`, `unsupported`.
- **Conflict**: divergent changes the engine will not apply automatically:
  different edits on both sides, delete-versus-edit, an independently changed
  core copy, or an unowned collision. Resolved only by an explicit choice.
- **Candidate**: a copy preserved under `~/.selr/bridge/conflicts/<skill>/`
  before a resolution replaces it.
- **Plan**: an immutable, content-addressed list of operations produced by
  inspection and classification, saved under `~/.selr/bridge/plans/<id>.json`.
  Apply performs exactly one plan and refuses a stale one.
- **Checkpoint**: the named boundary after each external write and before its
  receipt commit; the seam the recovery tests kill the process at.
- **Handoff snapshot**: portable Markdown project context, never native chat
  history.
- **Translator**: a named, tested conversion (`claude-command-to-skill`,
  `codex-command-to-skill`, `mcp-metadata`, `native:<provider>`).
- **Project pointer**: for a selected project, `AGENTS.md` is the portable
  instruction file and the bridge owns a `CLAUDE.md` holding only `@AGENTS.md`
  so Claude Code reads it in every session (`--project <dir>`).
