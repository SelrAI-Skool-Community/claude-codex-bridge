// Secrets scrubber — VENDORED. Do not edit the rules here.
//
//   Canonical source: the Go-Live Check kit (selrai-company/go-live-check),
//                     skills/go-live-check/scripts/golive.mjs — the secrets
//                     scanner section.
//   Vendored from commit: 4f97f0d263aeba75b3f93454c9dfbfa3d451686f
//
// The detection rules — the regexes, the placeholder test, the fingerprint,
// and scanLine — are copied verbatim from that commit, with one behaviour-
// neutral local patch: the private-key rule's first needle is split in two so
// the rule cannot match its own source line (see the note at the rule). A rule
// change is a deliberate re-vendor from the canonical source, never an edit
// here; that is what keeps every Selr kit independently installable without
// three rule sets silently drifting apart.
//
// What was adapted, and why: the canonical scanner walks a project directory
// and reads git history itself. This kit's engine has no filesystem access —
// content arrives as blobs of { path, content } — so the walk and the
// history scan are replaced by scrubFiles() over caller-supplied blobs.
// Scanning git history, where the canonical scanner would, is the caller's
// job before it hands content over.
//
// The one hard promise this module makes: a found value never leaves it.
// Only a rule id, a location and a short SHA-256 fingerprint come out.
//
// Zero dependencies beyond node:crypto (deterministic — no I/O, no clock).

import { createHash } from 'node:crypto';

// --- Rules, verbatim from the canonical source -----------------------------

const ENV_FILE_RE = /^\.env(\..+)?$/;
const ENV_PLACEHOLDER_FILE_RE = /(example|sample|template|dist)/i;
const SECRETISH_ENV_KEY_RE = /(PASS|PASSWORD|PWD|SECRET|TOKEN|CREDENTIAL|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i;
// The identifier prefix before the keyword is bounded ({0,64}) so a match
// attempt at any position does constant work — an unbounded * here made the
// scan quadratic in line length (a 200KB minified line took minutes). The
// optional quote between the key and the separator is what lets JSON-style
// `"api_key": "..."` match alongside code-style `api_key = '...'`.
const ASSIGNMENT_RE = /([A-Za-z0-9_$.-]{0,64}(?:password|passwd|pwd|secret|api[_-]?key|apikey|token|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_$]*)\s*['"`]?\s*(?:[:=]{1,3}|=>)\s*(['"`])([^'"`]{6,})\2/gi;
const CONNECTION_STRING_RE = /[a-z][a-z0-9+.-]{1,20}:\/\/([^/\s:@'"`]+):([^@\s'"`]{4,})@/gi;
// gh[opsur]_ covers every GitHub token family the gh CLI writes to disk:
// ghp_ (PAT), gho_ (OAuth), ghu_/ghs_ (app user/server), ghr_ (refresh, longer).
const TOKEN_SHAPE_RE = /\b(gh[opsur]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{30,})\b/g;

function isPlaceholderValue(raw) {
  const s = raw.trim().replace(/^['"`]|['"`]$/g, '');
  if (s.length < 6) return true;
  if (/^<.*>$/.test(s)) return true;
  if (/^\$\{.*\}$/.test(s) || s.startsWith('$')) return true;
  const low = s.toLowerCase();
  if (/(example|your[-_ ]|changeme|change-me|change_me|placeholder|dummy|sample|xxxx|todo|fixme|redacted|insert[-_ ])/.test(low)) return true;
  if (low.includes('process.env') || low.includes('os.environ')) return true;
  if (/^(.)\1+$/.test(s)) return true;
  if (/^(true|false|null|none|localhost|undefined)$/i.test(s)) return true;
  if (/^(bearer|basic|token)\s*$/i.test(s)) return true;
  return false;
}

function fingerprintOf(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

// Returns hits for one line of content; hit.value is stripped by the caller
// before anything is emitted. Shape-based rules (connection string, private
// key, token shape) run on every line, .env included — a token-shaped value or
// a connection string is a leak no matter what the key is named. The three
// shape regexes carry the g flag so every match on the line is examined — a
// placeholder-shaped match early on a line (a minified file is one line) must
// not mask a real secret later on the same line.
function scanLine(isEnvFile, line) {
  const hits = [];
  if (isEnvFile) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (m && SECRETISH_ENV_KEY_RE.test(m[1]) && !isPlaceholderValue(m[2])) {
      hits.push({ ruleId: 'env-assignment', label: m[1], value: m[2].trim().replace(/^['"`]|['"`]$/g, '') });
    }
  } else {
    for (const a of line.matchAll(ASSIGNMENT_RE)) {
      if (!isPlaceholderValue(a[3])) {
        hits.push({ ruleId: 'hardcoded-assignment', label: a[1].toLowerCase(), value: a[3] });
      }
    }
  }
  for (const c of line.matchAll(CONNECTION_STRING_RE)) {
    if (!isPlaceholderValue(c[2])) {
      hits.push({ ruleId: 'connection-string', label: 'connection-string', value: c[2] });
    }
  }
  // Local patch (claude-sync, 2026-08-31): the first needle is split so this
  // file never matches its own rule. A freshly generated base shares its
  // scripts, this one included, and the one-line form flagged itself and
  // blocked every first share. Detection is unchanged — both needles must
  // still appear together on one scanned line. Upstream carries the same
  // self-match; a re-vendor should carry this split or its equivalent.
  if (line.includes('-----' + 'BEGIN') && line.includes('PRIVATE KEY-----')) {
    hits.push({ ruleId: 'private-key', label: 'private-key', value: line.trim() });
  }
  for (const t of line.matchAll(TOKEN_SHAPE_RE)) {
    hits.push({ ruleId: 'token-shape', label: 'token-shape', value: t[1] });
  }
  return hits;
}

// --- Adapted entry point: content blobs in, value-free hits out ------------

function baseName(path) {
  const norm = path.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

/**
 * Scan caller-supplied file blobs for secrets.
 * files: [{ path: string, content: string }]
 * Returns { hits, filesScanned, filesSkipped } where every hit is
 * { ruleId, path, line, fingerprint, label } — never the value.
 */
export function scrubFiles(files) {
  const hits = [];
  const seen = new Set();
  let filesScanned = 0;
  const filesSkipped = [];

  for (const file of files) {
    const rel = file.path;
    const base = baseName(rel);
    const isEnvFile = ENV_FILE_RE.test(base);
    if (isEnvFile && ENV_PLACEHOLDER_FILE_RE.test(base)) {
      filesSkipped.push({ path: rel, why: 'placeholder-env-file' });
      continue;
    }
    if (file.content.includes('\0')) {
      filesSkipped.push({ path: rel, why: 'binary' });
      continue;
    }
    filesScanned += 1;
    const lines = file.content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const h of scanLine(isEnvFile, lines[i])) {
        const fingerprint = fingerprintOf(h.value);
        const dedupeKey = `${rel}|${h.label}|${fingerprint}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        // The value stops here. Only its fingerprint travels.
        hits.push({ ruleId: h.ruleId, path: rel, line: i + 1, fingerprint, label: h.label });
      }
    }
  }

  hits.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });

  return { hits, filesScanned, filesSkipped };
}
