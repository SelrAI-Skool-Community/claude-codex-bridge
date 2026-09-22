# Claude + Codex Bridge

Use Claude Code and Codex together without letting the useful parts of your setup drift apart.

The bridge will provide a shared portable core for instructions, selected skills, explicit knowledge, and project handoffs while preserving separate provider overlays for model routing, permissions, and provider-native behaviour. It will use native importers for supported bootstrap work, then manage ongoing reconciliation with previews, ownership receipts, conflict protection, atomic writes, recovery, and independent provider removal.

## Status

Specification complete; implementation has not started. This repository is private while the product is being built and verified.

## Product records

- [Linear project](https://linear.app/selr-ai/project/claude-codex-bridge-26698a0675fb)
- [Implementation issue — CORE-493](https://linear.app/selr-ai/issue/CORE-493/build-claude-codex-bridge-by-extracting-the-workshop-kit-foundations)
- [Implementation specification](docs/spec.md)
- [Native import and Workshop reuse research](docs/research/native-import-and-workshop-reuse.md)

## Implementation principle

Reuse before rewrite. The bridge is based on the Workshop Kit's proven provider adapters, per-file ownership, customisation preservation, shared knowledge, safe atomic writes, locks, interrupted-operation recovery, verification, and provider removal. Workshop-specific classroom content and onboarding stay behind.
