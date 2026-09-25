# Desktop check (a person runs this)

The command-line runs cover the engine and both apps' terminal builds on
macOS and Windows. The desktop apps read the same configuration folders, but
only a person can drive them. Run this once per platform before the Skool
launch, on a machine that has both desktop apps signed in.

Use a test account or a machine you are happy to bridge. Record the date, the
app versions and each result in the table.

| # | Do this | Expected |
|---|---|---|
| 1 | In the Claude Code tab of Claude Desktop, start a new local task and paste the prompt from `docs/start/setup.md`. | It explains what it found, shows a plan with Claude-only, Codex-only, shared and unsupported items, and asks you to approve a plan id. |
| 2 | Approve the plan. | It applies it, runs verify, and reports every check confirmed. |
| 3 | In the Codex desktop app, start a new local task and paste the same prompt. | Same as 1 and 2, for Codex. |
| 4 | In a new task in each app, ask: "What does the bridge give you?" | It names the portable instructions, its own overlay and shared knowledge. |
| 5 | In Codex, say: "Please remember for both apps: our delivery day is Thursday." Then in a new Claude task ask: "When is our delivery day?" | Thursday. |
| 6 | In a new task in each app, ask for one of your shared skills by what it does. | Both apps use the skill. |
| 7 | In Claude, say: "I'm switching to Codex, create a handoff for this project." Then in Codex, in the same project folder, ask it to carry on. | Codex names the open work from the handoff. |
| 8 | Ask either app to remove the other app from the bridge, approve, then ask it to verify. | The removed app's instructions file is back to its original text; the remaining app is healthy. |

| Platform | Date | Claude Desktop version | Codex app version | Results (1-8) | Notes |
|---|---|---|---|---|---|
| macOS | | | | | |
| Windows | | | | | |
