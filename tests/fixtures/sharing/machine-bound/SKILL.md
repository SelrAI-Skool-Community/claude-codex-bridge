---
name: report-render
description: Renders the weekly job report. Fixture skill — every machine-specific reference in here is planted.
---

# Report render

Builds the weekly report from the shared template, pins the output folder
with the mcp__wnd-pin-helper__pin_path connector, and converts the result.
Falls back to the mcp__file_system__read_file connector when the pin helper is missing.
Posts review notes through the mcp__claude_ai_Canva__comment-on-design connector.
The mcp__file_system connector must be set up before first use.
