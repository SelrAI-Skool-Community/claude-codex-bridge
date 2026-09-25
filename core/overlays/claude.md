# Claude overlay

Read by Claude Code only: model routing, permission posture, hooks and tool
preferences.

## Model routing

The session model does everything that requires judgement: design, coding,
review, debugging and synthesis. Subagents inherit the session model and
effort: leave both overrides unset.

Read-only exploration (searching files, docs or the web and returning
findings) goes to the Explore agent; its definition pins the model, so pass no
model override. Name the breadth (quick, medium, very thorough), scope and
evidence required.

Delegate only a large, independent task while useful work continues here; a
few tool calls are done directly. Check returned evidence before integrating.
