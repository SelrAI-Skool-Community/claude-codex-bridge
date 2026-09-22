// Portability check — finds things in a skill that only work on the machine
// it was written on. Deliberately a separate module from the secrets scrubber
// (scripts/scrub.mjs): folding the two together would let "no secrets found"
// masquerade as "this will work on someone else's machine". This check WARNS
// and never blocks — some machine-specific references are legitimate, and the
// person sharing is the one who knows which.
//
// What it looks for, in priority order (an earlier rule claims its span; a
// later rule never re-reports the same stretch of text):
//
//   windows-user-path   C:\Users\marlo\...  — a folder under one person's
//                       Windows account. Does not exist on anyone else's disk.
//   unix-user-path      /Users/marlo/... or /home/marlo/... — same thing on
//                       macOS and Linux.
//   unix-tool-path      /opt/homebrew/bin/ffmpeg or /usr/local/bin/tool — a
//                       tool installed at a machine-local spot on macOS/Linux.
//   unc-path            \\OFFICE-NAS\share\... — a network drive one office
//                       has mapped.
//   windows-abs-path    D:\tools\thing.exe — a fixed spot on one machine's
//                       disk, usually a locally installed tool.
//   mcp-server-ref      mcp__some-server__tool — a connector set up on this
//                       machine that a teammate may not have.
//
// What it deliberately does NOT flag, because these are the portable way to
// write the same thing: environment variable references (process.env.X,
// $env:X, %USERPROFILE%, ${HOME}), ${CLAUDE_PLUGIN_ROOT}, tilde paths (~/...),
// URLs, and Unix system paths like /usr/bin/env. The fixtures gate on zero
// false positives over exactly those.
//
// Pure function of its input. No filesystem, no network, no clock, no imports.

const RULES = [
  {
    ruleId: 'windows-user-path',
    // (?<![A-Za-z0-9]) keeps the "s:" in https:// from reading as a drive.
    // [\\/]+ absorbs the doubled backslashes of escaped strings in code.
    re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]+(?:Users|home)[\\/]+[^\s"'`)\],;|]+/g,
    plain: (ref) =>
      `"${shorten(ref)}" is a folder under one person's account on one Windows machine. ` +
      `On a teammate's machine that folder does not exist, so this part breaks for them. ` +
      `Use a path relative to the skill itself, or an environment variable like %USERPROFILE%.`
  },
  {
    ruleId: 'unix-user-path',
    re: /(?:^|[^\w:])(\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s"'`)\],;|]*)?)/g,
    group: 1,
    plain: (ref) =>
      `"${shorten(ref)}" is a folder under one person's account on one machine. ` +
      `On a teammate's machine that folder does not exist, so this part breaks for them. ` +
      `Use a path relative to the skill itself, or an environment variable like $HOME.`
  },
  {
    ruleId: 'unix-tool-path',
    re: /(?:^|[^\w:])(\/(?:opt|usr\/local)\/[^\s"'`)\],;|]+)/g,
    group: 1,
    plain: (ref) =>
      `"${shorten(ref)}" is a tool installed at a machine-local spot on one machine. ` +
      `A teammate may have it somewhere else, or not at all. Call the tool by name ` +
      `and let each machine's PATH find its own copy, or note it as something to install first.`
  },
  {
    ruleId: 'unc-path',
    re: /\\\\[A-Za-z0-9._$-]+\\[^\s"'`)\],;|]+/g,
    plain: (ref) =>
      `"${shorten(ref)}" is a shared network drive. A teammate outside your office network, ` +
      `or without that drive connected, gets a broken skill. Keep the file with the skill, ` +
      `or say in the skill's notes that this drive is needed.`
  },
  {
    ruleId: 'windows-abs-path',
    re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/]+[^\s"'`)\],;|]+/g,
    plain: (ref) =>
      `"${shorten(ref)}" is a fixed spot on one machine's disk — usually a program installed ` +
      `there. A teammate may have it somewhere else, or not at all. Call the program by name ` +
      `and let each machine find its own copy, or note it as something to install first.`
  },
  {
    ruleId: 'mcp-server-ref',
    re: /\bmcp__[A-Za-z0-9_-]+?__[A-Za-z0-9_-]+|\bmcp__[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*/g,
    plain: (ref) =>
      `"${ref}" calls an MCP server (a program Claude Code talks to for one service) set up on this machine. ` +
      `A teammate without it gets a skill that fails at this step. ` +
      `Name it in the skill's notes, or make the skill cope without it.`
  }
];

function shorten(ref) {
  return ref.length > 60 ? ref.slice(0, 57) + '...' : ref;
}

function trimTrailing(ref) {
  return ref.replace(/[.,:]+$/, '');
}

function overlaps(spans, start, end) {
  return spans.some((s) => start < s.end && end > s.start);
}

/**
 * Check caller-supplied file blobs for machine-specific references.
 * files: [{ path: string, content: string }]
 * Returns { warnings, filesChecked, filesSkipped } where every warning is
 * { ruleId, path, line, reference, plain }. Warnings only — never a block.
 */
export function checkPortability(files) {
  const warnings = [];
  const seen = new Set();
  let filesChecked = 0;
  const filesSkipped = [];

  for (const file of files) {
    if (file.content.includes('\0')) {
      filesSkipped.push({ path: file.path, why: 'binary' });
      continue;
    }
    filesChecked += 1;
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const claimed = [];
      for (const rule of RULES) {
        rule.re.lastIndex = 0;
        let m;
        while ((m = rule.re.exec(line)) !== null) {
          const raw = rule.group ? m[rule.group] : m[0];
          const start = rule.group ? m.index + m[0].indexOf(raw) : m.index;
          const end = start + raw.length;
          if (overlaps(claimed, start, end)) continue;
          claimed.push({ start, end });
          const reference = trimTrailing(raw);
          const dedupeKey = `${file.path}|${i + 1}|${rule.ruleId}|${reference}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          warnings.push({
            ruleId: rule.ruleId,
            path: file.path,
            line: i + 1,
            reference,
            plain: rule.plain(reference)
          });
        }
      }
    }
  }

  warnings.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });

  return { warnings, filesChecked, filesSkipped };
}
