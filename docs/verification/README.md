# Release evidence

A clean test suite is necessary but not sufficient to ship. Each platform needs
a real-machine run of the whole journey with the installed Claude Code and
Codex builds: install, initial bridge in both directions, sync, conflict,
interrupted recovery, fresh-session verification, provider removal and
uninstall. `node scripts/release-journey.mjs` produces the record; platform
override tests do not satisfy this gate.

Each record (`<platform>-<date>.json`) holds the exact provider versions,
operating system, source revision, fixture state, every command and its
observed result, and the fresh-session transcripts showing that each provider
read the shared instructions and knowledge, applied only its own overlay, and
consumed a handoff snapshot.

| Platform | Record | Status |
| --- | --- | --- |
| macOS | `macos-2026-09-22.json` | see the record's `status` |
| Windows | none yet | outstanding: the repository stays private until a Windows record with `status: passed` is added |

Running the journey needs sign-in for the child sessions: on macOS the Claude
token is read from the keychain into `CLAUDE_CODE_OAUTH_TOKEN`, and the user's
`~/.codex/auth.json` is linked into the fixture's `CODEX_HOME` for the duration
of the run. Nothing in the real home is changed.
