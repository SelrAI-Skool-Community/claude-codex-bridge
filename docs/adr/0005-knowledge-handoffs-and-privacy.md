# ADR-0005: Deliberate knowledge and handoffs; private state stays private

Status: accepted for CORE-493, 22 September 2026.

Shared knowledge is the Workshop helper, installed as `~/.selr/bridge/core/memory.mjs`:
keyed facts, preferences, rules and decisions with provider provenance,
timestamp and per-key revision, a lock, a stale-write conflict that returns
both values without writing, and atomic replacement. `core/knowledge-contract.md`
is the document both providers follow to read and save it, and to create
handoffs.

A handoff snapshot is portable Markdown rendered deterministically from
user-selected fields (purpose, current state, completed work, decisions, open
work, blockers, relevant paths, verification run) with source-provider
metadata. The vendored scrubber blocks a save that contains a secret-shaped
value; the portability checker warns about machine-specific references. The
snapshot is written under the core, never into a provider's transcript store.

The engine lists provider-private stores (transcripts, sessions, automatic
memory, caches, history) and credentials by presence only and classifies them
`unsupported`. MCP servers are inventoried as metadata: names, transport,
public endpoint, command and arguments, with environment values, headers,
tokens and key-bearing URLs withheld. The destination provider signs in itself.

## Rejected alternatives

| Rejected | Why |
| --- | --- |
| Import Claude project memories the way Codex's importer can | Those are provider-private automatic memories; the bridge shares only what the user deliberately records. |
| Write MCP servers into the other provider's config | Editing a user-owned config.toml or .claude.json risks the file, and the copy would still need its own sign-in. |
