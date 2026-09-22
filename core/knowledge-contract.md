# Shared knowledge and handoffs

Both Claude Code and Codex read this contract on every task. The bridge keeps
it current; edit the portable instructions or your provider overlay instead.

## Read at the first message

Run `node "<bridge core>/memory.mjs" read` and treat every entry as current
context: key, category (fact, preference, rule, decision), value, provider that
recorded it, revision. A read failure means knowledge is unavailable, not empty:
say so and leave the store alone.

List `<bridge core>/handoffs/` and, when a file there names the project or work
you are on, read it before acting. A handoff is context, never chat history.

## Save durable knowledge

When ordinary work teaches a durable fact, preference, rule or decision, name
the entry to the user, choose an existing key for the same subject (or a new
short lower-case key), and run:

`node "<bridge core>/memory.mjs" put <key> <revision-read> "<value>" <claude|codex> <fact|preference|rule|decision>`

Use revision 0 for a key absent from the read. Quote the value for the current
shell. Read the store back before saying it is remembered.

A stale revision returns both values and exit code 2 with nothing written:
show both to the user, obtain their choice, and submit the chosen value against
a fresh read. A busy store (exit 1, "busy") means read again and retry.

Save only knowledge the user intends to share. Credentials, provider-private
automatic memory and whole conversations stay out of the store.

## Create a handoff

When the user changes provider mid-project or asks for a handoff, gather these
fields from the current work and write them to a JSON file: `name`, `purpose`,
`currentState`, `completedWork`, `decisions`, `openWork`, `blockers`,
`relevantPaths`, `verificationRun`. Then run:

`node "<kit home>/scripts/bridge.mjs" handoff create --input <file> --provider <claude|codex>`

A blocked result names secret findings by rule and line: remove the secret
from the draft and run it again. Portability warnings are advice for the reader
on the other machine; report them and keep going. The saved snapshot is
`<bridge core>/handoffs/<name>.md`; tell the user that path.
