# Codex overlay

Read by Codex only. Claude Code has its own overlay; the bridge never copies
one into the other. Put Codex model routing, sandbox and approval posture, and
tool preferences here.

## Model routing

The session model (`gpt-6-astra` by default) does judgement, design, coding
choices, review, debugging and synthesis. Subagents inherit the session model
and effort: leave overrides unset.

`gpt-5.6-sol` qualifies only when all three hold: the outcome and procedure are
fixed before dispatch; mistakes are cheap to spot and redo (auth, billing, data
and production mutations never qualify); and the delegation is worth briefing
and checking while useful work continues here. For a qualifying task read
`model_reasoning_effort` from the active `config.toml`, pass that effort,
`model: "gpt-5.6-sol"` and `fork_turns: "none"`, and check the output as
evidence before acting on it.
