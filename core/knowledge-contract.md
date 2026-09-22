# Shared knowledge and handoffs

Both Claude Code and Codex read this contract on every task. The bridge owns
this file and rewrites it on update; durable changes belong in the portable
instructions or your provider overlay.

## Read at the first message

Run `node "<bridge core>/memory.mjs" read` and treat every entry as current
context. A read failure means knowledge is unavailable: tell the user and
continue without it, leaving the store as it is.

List `<bridge core>/handoffs/` and, when a file there names the project or work
you are on, read it before acting.

## Save durable knowledge

When ordinary work teaches a durable fact, preference, rule or decision, tell
the user the key and value you are about to save, choose an existing key for
the same subject (or a new short lower-case key), and run:

`node "<bridge core>/memory.mjs" put <key> <revision-read> "<value>" <claude|codex> <fact|preference|rule|decision>`

Use revision 0 for a key absent from the read. Quote the value for the current
shell. Report it as remembered only after `put` prints `saved: true`. A stale
revision (exit 2) or busy store (exit 1) prints the next step; follow it.

Save only knowledge the user intends to share. Credentials, provider-private
automatic memory and whole conversations stay out of the store.

## Create a handoff

When the user changes provider mid-project or asks for a handoff, gather these
fields from the current work and write them to a JSON file: `name`, `project`,
`purpose`, `currentState`, `completedWork`, `decisions`, `openWork`,
`blockers`, `relevantPaths`, `verificationRun`. Then run:

`node "<kit home>/scripts/bridge.mjs" handoff create --input <file> --provider <claude|codex>`

A blocked result names secret findings by rule and line: remove the secret
from the draft and run it again. Relay the `summary`; it carries the saved
path and any portability notes.
