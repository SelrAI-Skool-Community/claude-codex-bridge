---
name: claude-codex-bridge
description: Bridge a Claude Code and Codex setup into one portable core. Use to bridge or sync (first setup, update, conflict), check bridge status, hand off a project to the other provider, or remove a provider or uninstall.
---

# Claude + Codex Bridge

The engine decides; you narrate. Every discovery, classification, plan and
write comes from `node "<kit home>/scripts/bridge.mjs"`, which prints one JSON
document per command with a plain-language `summary`. Relay the summary and
the items that need the user, in the user's words. The one file-changing
command you run is `apply --plan <id>`, after the user approves that id.

Kit home: the `Kit home:` line of the bridge block in this provider's global
instructions; before the first install, the folder the setup prompt cloned
into. Options are documented at the top of `scripts/bridge.mjs`.

Always pass `--provider claude` or `--provider codex` for the app running this
session, and `--host desktop` or `--host cli` for how it is running. The
command line reads `CLAUDE_CONFIG_DIR` and `CODEX_HOME` itself; pass
`--claude-home` or `--codex-home` only when this session's provider home
differs from the shell's.

## Bridge or sync

1. `inspect`. Relay its `summary`: which providers were found, what was
   counted, and what is left alone.
2. `plan`, or `sync` for an existing bridge (they are the same command). Read
   `items`. Present them grouped by `disposition`, name every `unsupported`
   item, and put every `userAction` and `conflicts` entry in front of the
   user. The plan is the complete inventory: anything the user expected that
   the plan omits, report as not found.
3. When the user wants a different result, re-run `plan` with the documented
   options (`--skip`, `--only`, `--instructions-from`, `--resolve`). Each run
   prints a new `id`.
4. Ask for approval of the plan by its `id`. Then `apply --plan <id>`.
5. `verify`. Every check is `confirmed`, or the summary names what needs
   attention. Read the plan's `userSteps` back to the user: the user runs any
   native importer command in their own session; you report it as their step,
   then `verify` reports what arrived.
6. Done when `verify` returns `healthy: true` and you have told the user to
   start a new task in each app so the bridge block is read, and that if
   Claude Code asks to allow imported instruction files, they allow it.

`noop: true` on a plan means the setup already matches; say so and stop.

## Resume an interrupted operation

`status` reporting `pending`, or `verify` reporting a provider `blocked`
because the last operation did not complete: run `plan` then `apply` with the
new id. The engine continues from the receipt's saved progress and reports
the recovery. Leave the lock, receipt and installed files in place; the engine
reclaims a stale lock itself.

## Status

`status` lists shared skills in step, changes waiting for sync, conflicts
needing a choice, provider-specific and unsupported items, and unhealthy
checks.

## Handoff to the other provider

Create: follow "Create a handoff" in the knowledge contract (the bridge block
names it). Read: `handoff list`, `handoff show --name <name>`.

## Remove a provider or uninstall

`remove --remove-provider claude|codex` plans the removal of that provider's
bridge block and unchanged bridge-owned skill copies; `uninstall` plans the
removal of every provider and the unchanged bridge-owned core files. Show the
plan, get approval by id, `apply`, then `verify`. Customised files, the portable
instructions, shared knowledge and handoffs always remain, and the plan says so.

## Boundaries

Items the plan marks `unsupported` (credentials, private automatic memory,
transcripts, caches, MCP secrets) stay where they are; relay the plan's
`reason` for each.
