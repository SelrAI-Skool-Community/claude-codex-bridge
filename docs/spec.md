# Claude + Codex Bridge

## Problem Statement

People who use both Claude Code and Codex cannot keep one useful agent setup working coherently across both products. Each vendor now offers an importer, but those importers are designed primarily to create a point-in-time copy. They do not give the user a durable shared source of truth, explain which settings should remain different, reconcile later changes from either side, or safely resolve conflicts.

As a result, a user who moves between Claude Code and Codex accumulates duplicated instructions, differently aged skills, lost project context, and model-routing rules that are either copied to the wrong provider or silently drift apart. Re-running an importer can overwrite work or create more copies. Credentials, hooks, plugins, private memories, and conversations also have different formats and safety boundaries, so treating every file as synchronisable is unsafe.

The Workshop Kit already solves much of the difficult local lifecycle: shared instructions, a shared explicit knowledge store, separate provider routing, per-file ownership receipts, customisation preservation, safe paths, atomic replacement, locking, interrupted-run recovery, independent provider removal, and fixture-based verification. The product should extract and generalise that proven implementation rather than create another installer from scratch.

## Solution

Build a standalone Skool kit called **Claude + Codex Bridge**. A user can start it from either Claude Code or Codex and ask it to inspect their existing setup. It will show a read-only inventory and a proposed plan before changing anything. The plan classifies each discovered artefact as portable and shared, Claude-specific, Codex-specific, safely translatable, or unsupported.

For the initial move, the bridge should use the installed provider's native importer when that importer supports the required direction and artefact type. It must detect actual capabilities rather than assume a feature from a version number alone. The bridge then establishes a managed portable core that both providers read, while keeping separate overlays for provider-specific model routing, permissions, tools, and behaviour.

After setup, both providers can be used at the same time. Shared instructions, selected portable skills, explicit knowledge, and project handoff snapshots stay aligned. Changes are reconciled only through an explicit previewed sync. A change made on one side can be promoted into the portable core and applied to the other side. Divergent changes become visible conflicts and nothing is overwritten until the user chooses the result.

The bridge must reuse the Workshop Kit's provider adapter, ownership, file-safety, memory, recovery, removal, and verification designs at a pinned source revision. Workshop-specific onboarding, the full Workshop skill library, connection provisioning, and legacy Workshop migration are excluded from the extracted product. Where the Workshop Kit has no equivalent, existing Selr components should be reused before new code is written, including the secret scrubber and portability checks already proven in the Claude Sync kit.

## User Stories

1. As a Claude Code user, I want to move my useful setup into Codex, so that I can start using Codex without rebuilding my working environment by hand.
2. As a Codex user, I want to move my useful setup into Claude Code, so that I can start using Claude without manually translating every instruction and skill.
3. As a user of both providers, I want one portable core shared by Claude Code and Codex, so that common knowledge and working practices do not drift.
4. As a user of both providers, I want Claude-specific and Codex-specific overlays, so that each provider can retain the model routing and operating rules that suit it.
5. As a non-technical Skool member, I want to begin from one paste and a plain-English request, so that I do not need to understand configuration directories or shell commands.
6. As a cautious user, I want the first inspection to be read-only, so that I can understand what the bridge found before it changes my computer.
7. As a cautious user, I want to see the complete proposed migration and sync plan, so that I can approve the exact files and behaviours that will change.
8. As a cautious user, I want unsupported or ambiguous artefacts called out explicitly, so that silence is never mistaken for successful migration.
9. As an existing Claude Code user, I want my unrelated Claude instructions and configuration preserved, so that adopting the bridge does not erase my personal setup.
10. As an existing Codex user, I want my unrelated Codex instructions and configuration preserved, so that adopting the bridge does not erase my personal setup.
11. As a user with customised skills, I want customised and user-added files preserved, so that bridge updates cannot destroy work I own.
12. As a user with the same skill name on both providers, I want the bridge to identify whether the contents are equal, one-sided changes, or a true conflict, so that it can take the safest action.
13. As a user with a one-sided change, I want to promote that change into the portable core and copy it to the other provider, so that improvements follow me intentionally.
14. As a user with divergent changes, I want both versions preserved and presented for a choice, so that the bridge never guesses which one should win.
15. As a user who deleted a file on one side and edited it on the other, I want that state treated as a conflict, so that a useful edit is never erased by deletion propagation.
16. As a user, I want re-running setup or sync with no changes to be a no-op, so that repeating a command is safe.
17. As a user, I want shared instructions to be read by both providers in every new task, so that the portable core is effective without repeated copying.
18. As a user, I want each provider to read only its own routing overlay, so that Claude model choices are not imposed on Codex and Codex routing is not imposed on Claude.
19. As a user, I want selected provider-neutral skills available in both providers, so that reusable workflows work whichever agent I open.
20. As a user, I want skills checked for provider-specific assumptions before sharing, so that a copied skill does not falsely appear portable.
21. As a user, I want provider-specific skills to remain installed only where they work, so that portability does not reduce capability.
22. As a user, I want commands and subagents translated only when their behaviour has a safe equivalent, so that syntax conversion is not confused with behavioural compatibility.
23. As a user, I want hooks, plugins, and provider settings kept provider-specific unless an explicit translator supports them, so that the bridge does not invent unsafe equivalents.
24. As a user, I want MCP connection definitions inventoried without copying credentials, so that I can recreate useful connections without leaking secrets.
25. As a user, I want the bridge to tell me which provider still needs an interactive sign-in, so that configuration metadata is not mistaken for an authenticated connection.
26. As a user, I want deliberately recorded facts, preferences, rules, and decisions available to both providers, so that switching agents does not reset important context.
27. As a user, I want every shared knowledge entry to record its origin, revision, category, and update time, so that changes are traceable.
28. As a user, I want simultaneous edits to the same knowledge entry to produce a conflict rather than last-write-wins behaviour, so that one agent cannot silently erase the other's update.
29. As a privacy-conscious user, I want private automatic memories excluded, so that the bridge shares only information I deliberately place in the portable core.
30. As a privacy-conscious user, I want raw conversation databases and native session files left alone, so that the bridge does not corrupt or expose provider-owned data.
31. As a user changing providers mid-project, I want to generate a portable handoff snapshot containing current goals, decisions, progress, open questions, and relevant paths, so that the other provider can continue the work accurately.
32. As a user creating a handoff, I want secrets and machine-specific references detected before it is saved or shared, so that portability does not leak credentials or create a misleading handoff.
33. As a user, I want a handoff imported as context rather than forged as native chat history, so that the product makes an honest compatibility claim.
34. As a user with the latest native importer, I want the bridge to delegate supported bootstrap work to it, so that vendor-maintained translations are reused.
35. As a user with an older or restricted provider installation, I want the bridge to fall back to its own supported translators or explain the blocker, so that the workflow degrades safely.
36. As a user, I want the source provider setup left unchanged by an initial import, so that I can continue using it immediately.
37. As a user, I want bridge-managed writes to be atomic, so that a stopped process cannot leave half a configuration file.
38. As a user, I want an interrupted install, update, sync, or removal to resume from its recorded progress, so that closing an app or losing power does not trap me in a reinstall loop.
39. As a user, I want a live operation on the same setup detected, so that Claude and Codex cannot run competing syncs at the same time.
40. As a user, I want stale local locks reclaimed only after their owning process is confirmed stopped, so that a slow live operation is never mistaken for a crash.
41. As a user, I want the bridge to refuse writes through symbolic links or junctions it does not own, so that managed writes cannot escape into unexpected locations.
42. As a user, I want every managed file tied to an ownership receipt, so that identical contents alone are never treated as proof that the bridge owns my file.
43. As a user, I want a status command that reports shared, provider-specific, changed, conflicted, unsupported, and unhealthy items, so that I can see the state without changing it.
44. As a user, I want to remove Claude from the bridge without removing Codex or the portable core, so that changing tools does not destroy shared knowledge.
45. As a user, I want to remove Codex from the bridge without removing Claude or the portable core, so that changing tools does not destroy shared knowledge.
46. As a user, I want to uninstall the bridge without deleting customised files, so that leaving the product is safe and understandable.
47. As a user, I want bridge updates to preserve provider-specific overlays and user-owned changes, so that product upgrades do not reset my setup.
48. As a user on macOS, I want the complete install, sync, conflict, recovery, verification, and removal journey tested on my platform, so that the advertised path is real.
49. As a user on Windows, I want the complete install, sync, conflict, recovery, verification, and removal journey tested on my platform, so that portability is proven rather than inferred from macOS.
50. As a user, I want clear evidence that both fresh Claude Code and Codex tasks read the shared core and their own routing overlay, so that a successful file copy is not falsely reported as a working setup.
51. As a maintainer, I want extracted Workshop code to retain a documented source revision and behavioural test parity, so that reuse is verifiable and later Workshop fixes can be assessed.
52. As a maintainer, I want one deterministic bridge engine behind the user-facing skills, so that Claude and Codex cannot make different safety decisions from the same machine state.
53. As a maintainer, I want all mutations separated from inspection and planning, so that tests and users can exercise the decision layer without touching real configuration.
54. As a maintainer, I want machine and provider I/O isolated behind adapters, so that capability changes can be accommodated without rewriting the reconciliation rules.
55. As a Skool product owner, I want the repository private until its release gates are met, so that an unfinished installer is not presented as a community-ready kit.

## Implementation Decisions

- The product is a standalone repository and product identity, not another mode added to the Workshop Kit. It will remain private in the Skool organisation until its release gates pass.
- The initial implementation will be extracted from Workshop Kit revision `563a8746d4d1d4e0b6e0e59dfd80eb257728a47e`. The extraction will preserve a lineage manifest that records the upstream repository, revision, original module, local module, and whether each port is unchanged or adapted.
- Reuse is a delivery constraint. The file safety, atomic writer, setup lock, pending-intent receipt, skill ownership, customisation preservation, shared knowledge, provider addition/removal, and recovery behaviour will be ported with their existing tests before being renamed or generalised. Equivalent new implementations will not be accepted without a documented incompatibility.
- Workshop-specific onboarding, active/cold Workshop inventory, connection provisioning, classroom content, the full bundled skill library, and legacy Workshop migration will not be copied into the bridge.
- The Claude Sync secret scrubber and portability checker should be vendored from revision `5aa59e30391f7a5ff070dd9378032493760cbc4d` for handoff and export safety rather than reimplemented. Claude Sync's GitHub team, invitation, cross-machine background pull, and organisation-management features are not part of this product.
- The core domain vocabulary is: **portable core** for provider-neutral managed content; **provider adapter** for reading and writing one provider; **provider overlay** for intentionally different content; **receipt** for ownership and progress evidence; **baseline** for the last reconciled content; **conflict** for divergent changes that cannot be applied automatically; and **handoff snapshot** for portable project context that is not native chat history.
- The single public behavioural seam is the bridge workflow: `inspect → plan → apply → verify`. It is exposed through one deterministic engine used by both provider-facing skills. Inspection and planning are read-only. Apply consumes an immutable plan identifier and writes only the operations in that plan. Verify reads the resulting external state and reports evidence.
- The user-facing entry point is one installable `claude-codex-bridge` skill with equivalent Claude and Codex instructions. The skill explains progress in plain language but delegates all discovery, classification, planning, and mutation decisions to the deterministic engine.
- The bridge supports three initial states: Claude-only, Codex-only, and both providers already present. If neither provider is available, it stops with installation guidance and does not install either vendor product.
- Native importer use is capability-driven. The bridge inspects the installed product and available command surface, uses a native importer only for artefacts and directions that the installed version explicitly supports, records what it delegated, and verifies the result independently. An interactive slash command is reported as a user step and never claimed as programmatically completed.
- Native import is bootstrap, not the ongoing source of truth. Once managed, later changes flow through bridge reconciliation rather than repeated blanket imports.
- Every discovered artefact is assigned one disposition: `shared`, `claude-only`, `codex-only`, `translated`, or `unsupported`. The plan displays the disposition, source, destination, reason, collision status, and whether user action is required.
- The portable core covers provider-neutral global and selected-project instructions, selected compatible skills, explicit shared knowledge, and handoff snapshots. It is stored independently of either provider and survives removal of either one.
- Each provider receives a small managed instruction block that points to the portable instructions, the provider's own overlay, and the shared knowledge contract. Unrelated content surrounding that block remains user-owned. Ambiguous or edited ownership markers stop the write.
- Provider overlays are first-class managed documents and never synchronised across providers. Model routing, reasoning levels, delegation rules, permission posture, sandbox rules, and provider-specific behaviour belong in overlays.
- Skills use ordinary directories in each provider's supported skill root; the bridge does not depend on symbolic links or junction privileges. A canonical portable copy and baseline hashes allow later reconciliation while each provider keeps a normal discoverable copy.
- Reconciliation is a three-way comparison between the portable baseline, the current Claude copy, and the current Codex copy. An unchanged side plus one changed side produces a promotable one-sided change. Equal changes on both sides can be accepted once. Different changes, delete-versus-edit, or an independently changed portable core produce a conflict and no write.
- Conflicts are resolved explicitly by choosing Claude, Codex, the portable version, a merged result, or keeping the artefact provider-specific. Every candidate remains recoverable until verification completes.
- Identical bytes do not establish ownership. A file is bridge-owned only when its path and expected content hash are recorded in a committed receipt or in a pending intent written before the file operation.
- Shared knowledge retains the Workshop categories of fact, preference, rule, and decision, along with provider provenance, timestamp, and per-key revision. Writers lock, reload, compare revisions, and atomically replace the store. A stale same-key write returns both values without overwriting.
- Only deliberately recorded knowledge is shared. Provider-private automatic memory, complete transcripts, native conversation databases, caches, usage history, and authentication state are never read into the portable core.
- A handoff snapshot is portable Markdown generated from user-selected project context. Its schema includes purpose, current state, completed work, decisions, open work, blockers, relevant paths, verification already run, and source-provider metadata. It passes secret and portability checks before being committed.
- The bridge never writes handoff data into a provider's native transcript store. Each provider consumes the snapshot as explicit project context.
- MCP handling is metadata-first. The bridge may inventory names, public endpoints, executable/package identifiers, and non-secret configuration. Environment values, tokens, cookies, credential files, and authenticated session material are never copied. The destination provider must perform its own sign-in.
- Commands and subagents are translated only through named, tested translators. Provider-neutral workflows should preferentially become portable skills. Provider-specific hooks, plugins, settings, approval rules, and UI integrations remain provider-specific unless a later translator has a proven behavioural equivalent.
- The bridge performs no continuous filesystem watching and no last-write-wins background sync. Both providers read the same portable core on task start; provider copies are reconciled by an explicit `sync` request with a preview.
- All writes use the Workshop Kit's safe-path and atomic-replacement rules. The bridge refuses unowned symlink/junction traversal, records pending writes and removals before acting, uses an owner-bearing operation lock, and can resume from the receipt after interruption.
- Setup, sync, update, provider removal, and uninstall share the same ownership and recovery model. Removing one provider leaves the portable core, shared knowledge, handoffs, and the other provider intact. Uninstall removes only unchanged bridge-owned artefacts.
- The engine returns stable machine-readable results with plain-language summaries layered above them. Reports distinguish confirmed, unknown, unsupported, blocked, conflicted, and failed states; an unread value is never reported as absent.
- The runtime should remain local-first, dependency-light, and cross-platform. Network access is limited to installing/updating the kit and any explicitly delegated native-provider operation. The bridge has no telemetry and does not upload setup contents.
- The initial distribution is a one-paste install prompt suitable for Skool. Public release, marketplace packaging, and automatic distribution are separate release decisions after real-machine evidence exists.

## Testing Decisions

- Tests assert external behaviour through the one public `inspect → plan → apply → verify` workflow. Internal helper calls, private functions, file iteration order, and implementation-specific intermediate objects are not separate testing seams.
- Fixture homes represent complete Claude, Codex, and portable-core states. Each test asks the public workflow to inspect or change the fixture and then verifies the resulting files, receipts, reports, ownership, and preserved user content.
- The Workshop Kit fixture builder, attendee-prompt verifier, provider removal tests, migration safety tests, replay tests, and interrupted-operation checkpoint tests are the primary prior art. Extracted behaviours must pass equivalent scenarios before generic bridge behaviour is added.
- Claude Sync's deterministic-engine, secret-scanner, portability, and conflict fixtures are prior art only for the components actually vendored from that product.
- The matrix covers Claude-only to both, Codex-only to both, both unmanaged to managed, repeat no-op, provider update, one-sided change in each direction, equal two-sided change, divergent edit, edit-versus-delete, unowned collision, customised owned file, provider-specific retention, and unsupported artefacts.
- Native importer tests use capability fixtures for supported, unsupported, interactive-only, restricted-host, failed, and partially successful imports. The bridge must report delegated work accurately and verify destination state rather than trust process exit alone.
- Instruction tests prove unrelated content is preserved, one managed block is installed, ambiguous markers block writes, provider precedence is respected, and each provider reads the portable core plus only its own overlay.
- Skill tests cover multi-file skills, executable modes where supported, nested directories, provider-specific assumptions, user-added files, customised files, stale portable copies, and retirement of unchanged owned files.
- Knowledge tests cover both provider directions, different-key concurrent writes, same-key stale writes, busy locks, invalid schemas, atomic failure, fresh-task retrieval, and persistence after either provider is removed.
- Recovery tests enumerate every named external write boundary, stop the process after the write but before receipt commit, and then run the ordinary workflow again. The final state must match an uninterrupted run without duplicate installation or lost customisation.
- Safety tests cover symlink/junction parents, path traversal, malformed receipts, forged ownership, stale and live locks, another-host locks, temporary files, permissions where portable, and deletion outside an owned root.
- Handoff tests verify the schema, source attribution, deterministic output, secret blocking, portability warnings, selective context, and the guarantee that native transcript stores remain unchanged.
- MCP tests prove secret-bearing values and credential material never appear in plans, receipts, reports, logs, or destination configuration. Safe metadata can be planned separately from authentication.
- Removal tests prove one provider can be removed independently, the other continues to work, the portable core survives, customised provider artefacts remain, and repeated removal is harmless.
- macOS and Windows require real-machine release evidence for install, initial bridge in both directions, sync, conflict, interrupted recovery, fresh-session verification, provider removal, and uninstall. Platform override tests are useful but cannot satisfy this gate.
- Fresh-session verification must run against current released Claude Code and Codex builds. It must show that each provider reads the shared instructions and explicit knowledge, applies only its own routing overlay, and can consume a handoff snapshot.
- A clean test suite is necessary but not sufficient to ship. The release evidence records exact provider versions, operating system, source revision, fixture or clean account state, commands/actions taken, observed results, and any unsupported artefacts.

## Out of Scope

- Continuous background filesystem watching or silent last-write-wins synchronisation.
- Copying, synchronising, or storing credentials, API keys, cookies, OAuth sessions, billing state, or account tokens.
- Reading or merging provider-private automatic memories, raw conversation databases, complete transcript histories, caches, or usage history.
- Pretending a portable handoff is native conversation history or injecting it into undocumented provider stores.
- Behaviourally translating every hook, plugin, command, subagent, permission, or provider setting in the first release.
- Installing Claude Code, Codex, subscriptions, or vendor accounts for the user.
- Supporting Gemini, Cursor, or other agents in the first release, even where a native importer mentions them.
- Cross-machine, GitHub-team, invitation, offboarding, or automatic pull/push functionality already owned by Claude Sync.
- Shipping the Workshop Kit's classroom onboarding, active/cold skill catalogue, connection setup, routine setup, workshop migration, or complete bundled library.
- Replacing each provider's private memory system, model router, permission model, or plugin marketplace.
- A graphical desktop application, hosted account, cloud sync service, telemetry service, or administrator dashboard.
- Making the repository public or launching it to Skool before the specified real-machine release evidence is complete.

## Further Notes

- OpenAI's current importer covers Claude Code and Cursor in Codex CLI, and Claude Code, Claude Cowork, and Cursor in the desktop app. Its documented import surface includes instructions, settings, skills, plugins, projects, recent work, memories, chats, MCP servers, hooks, commands, and subagents, with product- and host-specific limits. The bridge must treat the official documentation and installed capability probe as authoritative at runtime: https://learn.chatgpt.com/docs/import
- Claude Code's current `/import` command accepts Codex, Gemini, and Cursor sources and documents importing instruction files, MCP servers, commands, subagents, and skills. It does not document importing Codex chats, private memories, hooks, plugins, or authentication state: https://code.claude.com/docs/en/commands
- The Workshop Kit's accepted provider-adapter, shared-memory, and interrupted-recovery decisions are the architectural source of truth for the extraction. The pinned source revision was current on 22 September 2026.
- Claude Sync overlaps only in cross-machine/team distribution, secret scanning, and portability checking. The bridge should interoperate with it later through the portable core but must not absorb its separate product lifecycle in this release.
- Implementation is complete only when all three starting states work; conflicts preserve every candidate; interrupted operations recover; removal is independent; real macOS and Windows journeys pass; and fresh Claude and Codex tasks demonstrably read the same portable core while retaining different routing overlays.
