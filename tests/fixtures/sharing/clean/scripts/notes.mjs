#!/usr/bin/env node
// Turn a transcript into notes. Pure text in, text out.

export function extractActions(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /\b(action|todo|follow[- ]?up)\b/i.test(line))
    .map((line) => line.trim());
}
