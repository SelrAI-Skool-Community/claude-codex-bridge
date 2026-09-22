# Native import coverage and Workshop Kit reuse

Research date: 22 September 2026. Native-product claims below come only from current first-party Anthropic and OpenAI documentation. Workshop findings use the newer of the two supplied checkouts: local source `/tmp/claude-codex-audit.pgP2XI/repo` at `claude-workshop-kit` commit [`563a8746d4d1d4e0b6e0e59dfd80eb257728a47e`](https://github.com/selrai-assets/claude-workshop-kit/tree/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e) (22 September 2026, 14:03 AEST), rather than `/Users/harveyshaw/selrai/products/claude-workshop-kit` at `0c669c35a44a08625008d1537f8e4177624bc88a` (11:00 AEST). The newer checkout was clean when inspected. Every Workshop path cited below is relative to that pinned local checkout as well as linking to the same commit online.

## Executive finding

Both products now have useful **one-way native importers**, and Claude Code can directly consume a repository's `AGENTS.md`. Those features substantially reduce bootstrap work, but the documented behavior does not amount to a durable, bidirectional Claude↔Codex bridge.

- Claude Code `/import` accepts Codex, Gemini CLI, or Cursor configuration and documents instructions, MCP servers, commands, subagents, and skills as carried across. Instruction migration is explicitly a **one-time copy** appended to the matching `CLAUDE.md`.
- ChatGPT desktop can import from Claude Code, Claude Cowork, or Cursor, and Codex CLI can import from Claude Code or Cursor. OpenAI's common import guide documents a broader mapping: instructions, settings, skills, plugins, project folders, Claude project memories, recent chats, MCP configuration, hooks, slash commands, and subagents. Desktop alone documents optional automatic updates.
- Neither vendor's documentation promises a shared canonical profile, conflict-aware ongoing memory, round-trip synchronization, per-file ownership receipts, or interruption recovery across both products. Those are the durable-bridge concerns for which the Workshop Kit already has tested mechanisms.

The bridge should therefore treat native import as an optional bootstrap/compatibility path, not reimplement it, while reusing the Workshop Kit's shared state and safety substrate for ongoing cross-provider operation.

## 1. Claude Code native behavior

### Explicitly documented

Claude Code's current command reference lists:

```text
/import [codex|gemini|cursor] [--dry-run] [--yes]
```

It says this imports configuration found on the machine, including instruction files, MCP servers, commands, subagents, and skills. `--dry-run` previews without writes; `--yes` bypasses the picker. The command requires Claude Code v2.1.213 or later (Cursor requires v2.1.265 or later) and is unavailable on Amazon Bedrock, Google Cloud Agent Platform, Microsoft Foundry, Claude Platform on AWS, Claude apps gateways, or when feature-flag fetching is disabled. In non-interactive `-p` mode it reports what it found and prints the confirmation command instead of immediately mutating state. [`/init` can also offer `/import` when it finds Codex or Gemini configuration.](https://code.claude.com/docs/en/commands.md)

Anthropic's memory documentation makes the instruction semantics more precise: `/import` **appends a one-time copy** of instruction files such as `AGENTS.md` to the matching `CLAUDE.md`, while carrying over MCP servers, commands, subagents, and skills. It does not describe a live link or subsequent synchronization. [Anthropic: “Migrate instructions from other tools”](https://code.claude.com/docs/en/memory.md#migrate-instructions-from-other-tools)

Claude Code v2.1.277+ can also read `AGENTS.md` directly, without importing it, when no `CLAUDE.md` or `CLAUDE.local.md` is present in the working directory or ancestors. A user can choose `claude-md-and-agents-md` to load both. Direct support is unavailable in some sessions (including third-party-provider/feature-flag-disabled cases); a `CLAUDE.md` containing `@AGENTS.md` is the documented fallback. Direct loading excludes `AGENTS.local.md`, `AGENTS.override.md`, and `.agents/`; `@path` imports within a loaded `AGENTS.md` are expanded. [Anthropic: `AGENTS.md`](https://code.claude.com/docs/en/memory.md#agents-md), [availability and differences](https://code.claude.com/docs/en/memory.md#when-agents-md-support-is-unavailable)

### Not documented as supported

The official `/import` description does **not** document importing Codex `config.toml` settings, hooks, plugins, sessions/chats, Codex memories, projects, credentials, or authentication state. This is an omission in the documentation, not proof that no release ever touches such data. Likewise, Anthropic documents neither automatic updates after import nor import history/rollback.

**Evidence-backed implication:** a bridge should not duplicate Claude's Codex→Claude conversion for the documented artifact types. It still needs an independent approach for ongoing shared state, ownership/conflicts, and environments where `/import` or direct `AGENTS.md` loading is unavailable.

## 2. OpenAI / Codex native behavior

### Explicitly documented user flows

OpenAI's import guide distinguishes two surfaces:

- **ChatGPT desktop:** imports from Claude Code, Claude Cowork, or Cursor. The user selects categories/items, existing agent setup is left unchanged, authorization-dependent plugins/connections are flagged for completion, import history is available, and optional automatic updates can keep imported work synchronized with its source.
- **Codex CLI:** `/import` imports from Claude Code or Cursor in a local session. It can import up to 50 chats from the prior 30 days and is unavailable while a task is running, in a remote session, or while attached to a local app-server daemon.

The common guide's item mapping (under its “What ChatGPT can import” heading) is:

| Source item | Destination |
|---|---|
| Instruction files | `AGENTS.md` |
| `settings.json` | `config.toml` |
| Skills | Codex skills |
| Plugins | Plugins |
| Existing project folders | Projects using the same folders |
| Claude Code project memories | Memories |
| Chats from the last 30 days | ChatGPT chats |
| MCP server configuration | Codex MCP configuration |
| Hooks | Codex hooks |
| Slash commands | Skills |
| Subagents | Codex subagents |

OpenAI explicitly asks users to review imported tool permissions, MCP authentication/headers/environment/transports, hooks, plugin/marketplace follow-up, and command prompts that depend on arguments, shell interpolation, or path placeholders; reauthentication may be required. [OpenAI: Import from another agent](https://learn.chatgpt.com/docs/import)

### Explicitly documented app-server contract

Codex app-server exposes `externalAgentConfig/detect`, `externalAgentConfig/import`, progress/completion notifications, and completed-import history. Supported API item types are `AGENTS_MD`, `CONFIG`, `SKILLS`, `PLUGINS`, `MCP_SERVER_CONFIG`, `SUBAGENTS`, `HOOKS`, `COMMANDS`, and `SESSIONS`. Detection returns only work still needed: a non-empty existing `AGENTS.md` causes AGENTS migration to be skipped, and skill import never overwrites an existing skill directory. Plugin and session imports can complete asynchronously, with per-type successes and failures. [OpenAI: Detect and import external agent config](https://learn.chatgpt.com/docs/app-server#detect-and-import-external-agent-config)

### Not documented as supported

OpenAI does not document automatic updates for **Codex CLI**; the synchronization control is described for desktop. The docs also do not promise bidirectional propagation back into Claude, per-file merging inside a colliding skill directory, shared credentials, identical hook semantics, or atomic rollback of a multi-item import. The public user guide says Claude project memories can be imported, but the app-server API has no separately named memory item type; consumers should not infer a stable standalone memory-conversion API beyond the documented import flow.

**Evidence-backed implication:** use the native Claude→Codex importer where the host exposes it. A standalone bridge should not overwrite the destination merely because native detection skipped a non-empty `AGENTS.md` or existing skill directory; those are precisely the collision cases requiring ownership-aware handling.

## 3. What the native importers leave for a standalone bridge

This boundary is an inference from the documented capabilities and omissions above:

1. **Bootstrap is largely native.** Both directions can copy the main reusable configuration surfaces; Codex's importer additionally covers settings, sessions, Claude project memories, hooks, and plugins.
2. **A canonical live layer is not native.** Claude documents one-time instruction copying, while OpenAI desktop documents source→destination updates, not round-trip co-authoring. Neither describes one profile/knowledge store deliberately read by both providers.
3. **Collision safety is only partial.** Codex preserves existing setup and skips occupied instruction/skill destinations, but does not document per-file reconciliation. Claude documents preview/selection but no ownership receipt or merge contract.
4. **Private provider state should remain provider-private unless the user invokes a native migration.** OpenAI can deliberately import Claude project memories and recent chats; the Workshop model, by contrast, shares only intentionally recorded knowledge and explicitly excludes private automatic memory and whole conversations. These are compatible policies if the bridge does not silently scrape either provider's private state.
5. **Credentials and capability parity are outside import.** OpenAI warns that reauthentication and manual plugin/connection setup may be needed. A copied skill or connector definition does not prove the other provider has a usable account connection.

## 4. Workshop Kit mechanisms to reuse, not rewrite

All links in this section pin the inspected commit, `563a8746…`.

### Shared instructions, profile, and deliberate memory

Reuse the shared receipt and provider adapters rather than creating parallel Claude/Codex profiles. ADR-0007 defines one receipt at `~/.selr/workshop/manifest.json`, one onboarding flag/profile pointer, per-provider install metadata, and a copied shared instruction body that survives deletion of the download ([ADR-0007, lines 5–19](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/docs/adr/0007-provider-install-adapters.md#L5-L19)). The installed instructions require both hosts to read the same profile and memory helper on the first task, while keeping provider-private memory and conversations outside the shared store ([`my-assistant/instructions.md`, lines 5–43](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/my-assistant/instructions.md#L5-L43)).

Reuse `scripts/workshop-memory.mjs` as the starting concurrency contract: keyed facts/preferences/rules/decisions, provider provenance, per-key revisions, a lock, stale-write conflict returns, and atomic rename ([lines 8–44](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/workshop-memory.mjs#L8-L44)). ADR-0005 records the intended boundary: deliberate workshop knowledge is shared; private automatic memory and entire conversations are not ([ADR-0005, lines 5–27](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/docs/adr/0005-shared-workshop-memory.md#L5-L27)).

### Provider overlays instead of flattened instructions

Reuse the split between shared behavior and provider routing overlays. The installer copies `instructions.md` once and installs `routing-claude.md` or `routing-codex.md`, then points the current provider's marked global block at both ([`installProvider`, lines 149–205](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/install-workshop.mjs#L149-L205) and [266–280](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/install-workshop.mjs#L266-L280)). The actual overlay files isolate host-specific model/delegation policy rather than contaminating shared instructions: [`routing/claude.md`](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/my-assistant/routing/claude.md) and [`routing/codex.md`](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/my-assistant/routing/codex.md).

The adapter should remain explicit rather than assuming identical instruction-file semantics. ADR-0007 records the provider paths and preserves unrelated global content ([lines 12–19](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/docs/adr/0007-provider-install-adapters.md#L12-L19)). Claude's newly documented direct `AGENTS.md` support may reduce adapter work in some projects, but its availability constraints and precedence rules mean it does not eliminate the overlay abstraction.

### Ownership receipts and preservation

Reuse the receipt rule: ownership is proven by recorded per-file hashes or a pre-write intent, never by a familiar name or equality with the current kit. The installer stages intended hashes before writes and commits them afterward ([`installProvider`, lines 134–148](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/install-workshop.mjs#L134-L148)); ADR-0009 states the recovery invariant ([lines 29–47](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/docs/adr/0009-interrupted-setup-recovery.md#L29-L47)).

For legacy adoption, reuse the Workshop migration evidence model rather than content/name guesses: hashes from known shipped versions, old receipts and surviving kits; unproven or linked content is preserved and reported ([ADR-0008, lines 30–53](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/docs/adr/0008-legacy-upgrade-through-the-installer.md#L30-L53)). This is materially stronger than either native importer's documented collision behavior.

### Safe atomic writes, locks, and recovery

Reuse `workshop-files.mjs` rather than adding another file utility. `safePath` refuses writes through symlinked parents; `save` uses a unique same-directory temporary file plus atomic rename; stale kit temp files are identifiable and sweepable ([lines 7–41](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/workshop-files.mjs#L7-L41)). `acquireSetupLock` records PID, host, purpose and start time; it reclaims only a stopped local owner, never a live/remote/recent owner ([lines 65–95](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/workshop-files.mjs#L65-L95)).

Reuse the receipt's `pending` replay and `install({ checkpoint })` seam. The installer carries intents across runs, resumes the other provider half only when appropriate, adopts only staged writes, finishes staged removals, and clears `pending` only after success ([`install`, lines 24–120](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/install-workshop.mjs#L24-L120)). ADR-0009 is the concise contract for lock recovery, write/removal intent and named checkpoints ([lines 48–82](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/docs/adr/0009-interrupted-setup-recovery.md#L48-L82)).

### Skill copying and customisation preservation

Reuse `installSkill`/`retireSkill`. Installation inventories every file in a skill, preserves unknown or changed files, retains executable modes, stages a whole skill before writing, and records every owned file. Retirement removes only a wholly unmodified, fully owned directory; one user-added, changed, or linked file preserves the whole skill ([`scripts/workshop-skills.mjs`, lines 7–78](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/workshop-skills.mjs#L7-L78)). This should sit above native import: native import can bootstrap a vacant destination, while the receipt logic owns future managed updates and collision reporting.

### Migrations and tests

Reuse the migration/verifier/checkpoint harnesses as executable specifications:

- [`test-workshop-install.mjs`](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/test-workshop-install.mjs) covers both providers, repeat installs, preserved user instructions/config, supporting-file edits, shared onboarding/profile/memory, stale/concurrent memory writes, active Codex overrides, and provider removal/re-addition.
- [`test-workshop-migration.mjs`, lines 19–81](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/test-workshop-migration.mjs#L19-L81) drives seven legacy shapes, verifies customised/user-added/independent/linked content, repeat-run idempotence, Claude→Codex addition, and Codex-first upgrade using the same profile.
- [`test-workshop-recovery.mjs`, lines 74–114](https://github.com/selrai-assets/claude-workshop-kit/blob/563a8746d4d1d4e0b6e0e59dfd80eb257728a47e/scripts/test-workshop-recovery.mjs#L74-L114) kills installs at enumerated write boundaries and verifies recovery, ownership adoption, personal-file preservation and stable repeats; later cases cover interrupted updates, legacy upgrades, locks, temp cleanup, and removals.

On the inspected commit, all three focused suites passed locally: fresh/repeat/provider-sharing behavior; all seven legacy shapes; and 41 interruption-recovery scenarios. This verifies CLI/filesystem behavior on the current macOS checkout only. It does not establish desktop discovery, every native importer UI, or Windows behavior; the Workshop ADRs expressly keep those claims separate.

## 5. Reuse recommendation, bounded by evidence

Do not build another general Claude↔Codex configuration converter. Prefer each host's native importer for the artifact types and environments it explicitly supports, and surface its preview/follow-up requirements. Reuse the Workshop Kit implementation for the distinct durable responsibilities it already proves:

- one shared onboarding profile and deliberately shared knowledge store;
- thin, owned provider adapters plus provider-specific routing overlays;
- per-file receipts and explicit preservation of unowned/customised content;
- atomic writes, owner-aware locking, pending-intent recovery and idempotent retries;
- whole-skill copy/update/retirement with supporting-file preservation;
- evidence-based legacy migration and the existing install/migration/recovery tests.

Any future claim that a native importer also covers an omitted category should be added only when a first-party document or verified host behavior establishes it. Until then, describe those categories as **not documented as supported**, not as impossible.
