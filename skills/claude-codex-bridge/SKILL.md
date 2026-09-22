---
name: claude-codex-bridge
description: Bridge one setup between Claude Code and Codex. Use when the user wants to move their Claude setup into Codex or their Codex setup into Claude, keep skills in step between the two, check bridge status, sync or resolve a conflict, create or read a project handoff for the other provider, remove one provider from the bridge, or uninstall the bridge.
---

# Claude + Codex Bridge

The bridge engine decides; you narrate. Every discovery, classification, plan
and write comes from `node "<kit home>/scripts/bridge.mjs"`, which prints one
JSON document per command with a plain-language `summary`. Relay the summary
and the items that need the user, in the user's words, and run nothing that
changes files except `apply` with a plan id the user has approved.

Kit home: the bridge block in this provider's global instructions names it
(`Kit home:`). Without a block, the kit is at `~/.selr/claude-codex-bridge`
after setup, or wherever the setup prompt cloned it.

Always pass `--provider claude` or `--provider codex` for the app running this
session, and `--host desktop` or `--host cli` for how it is running. Add
`--claude-home` or `--codex-home` only when the session's `CLAUDE_CONFIG_DIR`
or `CODEX_HOME` is set (the command line reads those itself when `--home` is
absent).

## Bridge or sync

1. `inspect`. Say which providers were found, how many skills, commands, MCP
   servers and provider-private stores, and whether a native importer is
   available. The inventory changes nothing.
2. `plan`, or `sync` for an existing bridge (they are the same command). Read
   `items`: each has a `disposition` (`shared`, `claude-only`, `codex-only`,
   `translated`, `unsupported`), a `reason`, a `collision`, and a `userAction`
   when the user must decide. Present the plan grouped by disposition, name
   every `unsupported` item, and put every `userAction` and `conflicts` entry
   in front of the user. Silence is never success: an item that is not in the
   plan was not found.
3. When the user wants a different result, re-run `plan` with their choices:
   `--skip a,b` keeps skills provider-specific, `--only a,b` narrows sharing,
   `--instructions-from claude|codex|none` picks the portable-instructions seed,
   `--resolve <skill>=claude|codex|core|keep-separate` settles a conflict (for a
   merged result they edit one copy first, then choose it). Each run prints a
   new `id`.
4. Ask for approval of the plan by its `id`. Then `apply --plan <id>`.
5. `verify`. Every check is `confirmed`, or the summary names what needs
   attention. Read `userSteps` from the plan back to the user: a native
   importer command is theirs to run, never yours, and `verify` afterwards
   reports what arrived.
6. Done when `verify` reports healthy and the user knows to start a new task
   in each app so the bridge block is read.

`noop: true` on a plan means the setup already matches; say so and stop.

## Resume an interrupted operation

`status` or `verify` reporting `pending`, or a bridge block saying the last
operation stopped: run `plan` then `apply` with the new id. The engine
continues from the receipt's saved progress and reports the recovery. The
lock, receipt and installed files stay as they are; the engine reclaims a lock
only when its owning process has stopped.

## Status

`status` lists shared skills in step, changes waiting for sync, conflicts
needing a choice, provider-specific and unsupported items, and unhealthy
checks. Report it as is.

## Handoff to the other provider

Follow `<bridge core>/knowledge-contract.md` (the bridge block names it): gather
the fields, write the JSON file, run `handoff create`. A `blocked` result names
the secret's rule and line; remove it and run again. `handoff list` and
`handoff show --name <name>` read snapshots. A snapshot is context for the
other provider's next task; it is never written into either app's chat history.

## Remove a provider or uninstall

`remove --remove-provider claude|codex` plans the removal of that provider's
bridge block and unchanged bridge-owned skill copies; `uninstall` plans the
removal of every provider and the unchanged bridge-owned core files. Show the
plan, get approval by id, `apply`, then `verify`. Customised files, the portable
instructions, shared knowledge and handoffs always remain, and the plan says so.

## Boundaries

The engine never reads credentials, private automatic memory, session
transcripts or caches, and never copies MCP secrets: the plan lists these as
`unsupported` or withholds the values. Report them that way; do not work around
them by copying files yourself.
