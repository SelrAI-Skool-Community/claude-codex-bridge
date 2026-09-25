# Release evidence

A clean test suite is necessary but not sufficient to ship. Each platform
needs real-machine records from the installed Claude Code and Codex builds.
The fixture suite (`npm test`) runs on macOS, Linux and Windows in CI.

| Record | Produced by | What it proves |
| --- | --- | --- |
| `macos-<date>.json`, `windows-<date>.json` | `scripts/release-journey.mjs` | The engine lifecycle end to end: bridge in both directions, sync, conflict, interrupted recovery, fresh sessions reading the core and only their own overlay, removal, re-addition and uninstall. |
| `acceptance-<platform>-<date>.json` | `scripts/acceptance.mjs` | The member journey with real agents: one-paste setup Claude-first and Codex-first, unprompted use of shared instructions and skills, knowledge saved and read in both directions, a standing-instruction change, a handoff, an agent-driven sync. |
| `discovery-<platform>-<date>.json` | `scripts/skill-discovery-probe.mjs` | Which skill folders each app loads (ADR-0006). |
| `rehearsal-macos-<date>.json` | `scripts/rehearse-real-setup.mjs` | The lifecycle on a copy of a real setup: realistic sizes, no MCP secret in any output, provider files restored, the real home byte-identical afterwards. Counts only. |
| `desktop-checklist.md` | A person | The desktop apps, which cannot be driven from a script. |

## Current results (25 September 2026)

| Record | macOS 26 (Apple silicon) | Windows Server 2025 (GitHub-hosted) |
| --- | --- | --- |
| Release journey | passed, 55 steps | passed |
| Agent acceptance | passed, 45 of 45 checks | passed, 45 of 45 checks |
| Skill discovery | passed | passed |
| Real-setup rehearsal | passed | not run (needs a real Windows setup) |
| Desktop checklist | not yet run | not yet run |

Both platforms used Claude Code 2.1.276 and Codex 0.155.0. Codex on Windows
finds `~/.agents` from the Windows user profile rather than `USERPROFILE`, so
on the CI machine the harness points the profile's `.agents` folder at the
fixture (`pointRealAgentsAt` in `scripts/agent-cli.mjs`); on a member's
computer those are the same folder. `macos-2026-09-22.json` is the earlier
record from before the ship work.

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
