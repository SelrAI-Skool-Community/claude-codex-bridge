# Claude overlay

Read by Claude Code only. Codex has its own overlay; the bridge never copies
one into the other. Put Claude model routing, permission posture, hooks and
tool preferences here.

## Model routing

The session model does design, coding, review, debugging and synthesis.
Subagents inherit the session model and effort: leave both overrides unset.

Read-only exploration (searching files, docs or the web and returning findings,
deciding nothing) goes to the Explore agent on `claude-sonnet-5` with inherited
effort. Name the breadth (quick, medium, very thorough), scope and evidence
required. Explore changes no files.

Delegate only a large, independent task while useful work continues here; a
few tool calls are done directly. Check returned evidence before integrating.
