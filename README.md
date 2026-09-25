# Claude + Codex Bridge

Use Claude Code and Codex together without letting the useful parts of your setup drift apart.

The bridge gives both apps one **portable core**: shared instructions, selected portable skills, explicit shared knowledge, and project handoffs. Each app keeps its own **overlay** for model routing, permissions and app-specific behaviour, so nothing that belongs to one app is forced on the other. Everything the bridge does starts read-only: it inspects, shows a plan, and writes only the plan you approve. Changes on either side are reconciled by an explicit, previewed sync; divergent changes become visible conflicts and nothing is overwritten until you choose.

## For members

Open Claude Code or Codex and paste the prompt in [`docs/start/setup.md`](docs/start/setup.md). It installs the kit, shows what it found, and asks before it changes anything. The same prompt updates and syncs the bridge later.

What stays private: credentials, sign-in state, private automatic memory, chats and session files. The bridge lists them and leaves them alone. MCP connections are inventoried as metadata only; the other app signs in itself.

## For maintainers

- `docs/spec.md`: the implementation specification (mirrors Linear CORE-493).
- `CONTEXT.md` and `docs/adr/`: vocabulary and the decisions behind the engine.
- `docs/lineage.json`: every module extracted from the Workshop Kit or vendored from Claude Sync, with its pinned upstream revision.
- `docs/verification/`: real-machine release evidence.

```
npm test          # fixture-driven tests through inspect → plan → apply → verify
npm run check     # syntax check every script
npm run lineage   # verify vendored files against their pins
npm run journey     # engine lifecycle with the installed Claude Code and Codex builds
npm run acceptance  # the member journey driven through real agents
npm run discovery   # which skill folders each installed app loads
npm run rehearse    # the lifecycle on a copy of your own setup (counts only)
```

Engine command line: `node scripts/bridge.mjs inspect | plan | apply --plan <id> | verify | status | sync | remove | uninstall | handoff`. Each prints one JSON document with a plain-language summary.

## Status

Engine, skill and tests are in place. The release journey and the agent acceptance suite pass on macOS and on a GitHub-hosted Windows machine (see `docs/verification/README.md`). Before a Skool launch: run the desktop checklist on both platforms, merge, and open member access to this repository.

## Product records

- [Linear project](https://linear.app/selr-ai/project/claude-codex-bridge-26698a0675fb)
- [Implementation issue: CORE-493](https://linear.app/selr-ai/issue/CORE-493/build-claude-codex-bridge-by-extracting-the-workshop-kit-foundations)
- [Native import and Workshop reuse research](docs/research/native-import-and-workshop-reuse.md)
