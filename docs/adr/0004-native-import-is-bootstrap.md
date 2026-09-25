# ADR-0004: Native importers are capability-probed bootstrap, never the source of truth

Status: accepted for CORE-493, 22 September 2026.

`scripts/bridge-native-import.mjs` probes the installed product: Claude Code's
documented `/import codex` (2.1.213 or later, unavailable on restricted hosts)
and Codex CLI's `/import` (documented without a minimum version). Both are
interactive commands, so the plan lists them as the user's step with the exact
command and the artefacts the vendor documents; the bridge never claims to have
run them. Verify then inspects the destination independently. A programmatic
runner, when a host offers one, records `completed`, `partial`, `failed` or
`blocked` in the receipt with the same independent verification.

The bridge's own translators cover the durable surfaces (instructions, skills,
plain commands, MCP metadata) so nothing depends on the importer being present.
Once bridged, changes flow only through previewed sync.

## Rejected alternatives

| Rejected | Why |
| --- | --- |
| Infer importer support from a version number alone | The spec requires detected capability; a version gate is the documented minimum, not proof, and the result is verified on disk. |
| Drive the interactive command through a pseudo-terminal | Fragile and unverifiable; the user runs it and the bridge reads the outcome. |
