# Release evidence

A clean test suite is necessary but not sufficient to ship. Each platform
needs real-machine records from the installed Claude Code and Codex builds.
The fixture suite (`npm test`) runs on macOS, Linux and Windows in CI.

| Record | Produced by | What it proves |
| --- | --- | --- |
| `macos-<date>.json`, `windows-journey.json` | `scripts/release-journey.mjs` | The engine lifecycle end to end: bridge in both directions, sync, conflict, interrupted recovery, fresh sessions reading the core and only their own overlay, removal, re-addition and uninstall. |
| `acceptance-macos-<date>.json`, `windows-acceptance.json` | `scripts/acceptance.mjs` | The member journey with real agents: one-paste setup Claude-first and Codex-first, unprompted use of shared instructions and skills, knowledge saved and read in both directions, a standing-instruction change, a handoff, an agent-driven sync. |
| `discovery-macos-<date>.json`, `windows-discovery.json` | `scripts/skill-discovery-probe.mjs` | Which skill folders each app loads (ADR-0006). |
| `rehearsal-macos-<date>.json` | `scripts/rehearse-real-setup.mjs` | The lifecycle on a copy of a real setup: realistic sizes, no MCP secret in any output, provider files restored, the real home byte-identical afterwards. Counts only. |
| `desktop-checklist.md` | A person | The desktop apps, which cannot be driven from a script. |

Every record holds the operating system, the exact app versions, the source
revision, and each command or prompt with the observed result.

## How the runs sign in

Agent runs use a fixture home and never write to the real one (on macOS they
run inside `sandbox-exec` with the real home read-only). Sign-in is an access
token only, with no refresh token. Claude's token comes from
`CLAUDE_CODE_OAUTH_TOKEN` or the macOS keychain. Codex's comes from
`CCB_CODEX_AUTH` or a copy of the current `~/.codex/auth.json` with the refresh
token removed, taken again before every turn. The Windows workflow
(`.github/workflows/windows-release.yml`) reads the same two values from
repository secrets, which are removed after each run. A Codex access token is
retired when the real app refreshes its sign-in, so a Windows run has to finish
before that happens; if Codex turns fail with a refresh-token error, refresh
the secret and run again.
