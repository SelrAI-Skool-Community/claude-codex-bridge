// Runs the real Claude Code and Codex command lines against a fixture home.
// Shared by the fresh-session check, the release journey and the acceptance
// suite. Every run gets the fixture as HOME/USERPROFILE and as the provider's
// config home, the prompt on stdin (no shell quoting on any platform), and
// sign-in that cannot be refreshed or written back:
//   Claude: CLAUDE_CODE_OAUTH_TOKEN (env), or on macOS the keychain access token.
//   Codex:  CCB_CODEX_AUTH (auth.json text) or CODEX_API_KEY (env), or the
//           current user's ~/.codex/auth.json with its refresh token removed.
// On macOS each run is wrapped in sandbox-exec so it cannot write anywhere in
// the real home folder.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { join } from 'node:path';

const REAL_HOME = homedir();
const win = platform() === 'win32';

export function versionOf(bin) { try { return spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000, shell: win }).stdout.trim() || null; } catch { return null; } }

export function claudeToken(env = process.env) {
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return env.CLAUDE_CODE_OAUTH_TOKEN;
  if (platform() !== 'darwin') return null;
  try { return JSON.parse(execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8' })).claudeAiOauth?.accessToken || null; } catch { return null; }
}
export function codexAuth(env = process.env) {
  if (env.CCB_CODEX_AUTH) return env.CCB_CODEX_AUTH;
  const real = join(REAL_HOME, '.codex/auth.json');
  if (!existsSync(real)) return null;
  const data = JSON.parse(readFileSync(real, 'utf8'));
  if (data.tokens) data.tokens = { ...data.tokens, refresh_token: '' };
  return JSON.stringify(data);
}
// Put sign-in into a fixture's Codex home. Nothing is linked to the real file.
export function prepareCodexHome(codexHome, env = process.env) {
  mkdirSync(codexHome, { recursive: true });
  const auth = codexAuth(env);
  if (auth) writeFileSync(join(codexHome, 'auth.json'), auth, { mode: 0o600 });
}

function sandboxProfile() {
  const path = join(mkdtempSync(join(tmpdir(), 'ccb-sb-')), 'profile.sb');
  writeFileSync(path, `(version 1)(allow default)(deny file-write* (subpath ${JSON.stringify(REAL_HOME)}))\n`);
  return path;
}
let profile = null;

// One turn. `session` carries the conversation between turns: pass the object
// returned by the previous turn to continue it.
export function runAgent(provider, { home, cwd, prompt, session = null, env = process.env, timeout = 480000 }) {
  const started = Date.now();
  const childEnv = { ...env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex') };
  delete childEnv.CCB_CODEX_AUTH;
  let bin, args, last = null, id = session?.id || null;
  if (provider === 'claude') {
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = claudeToken(env) || '';
    bin = env.CCB_CLAUDE_BIN || 'claude';
    if (!id) id = randomUUID();
    args = ['-p', '--output-format', 'text', '--dangerously-skip-permissions', ...(session ? ['--resume', id] : ['--session-id', id])];
  } else {
    bin = env.CCB_CODEX_BIN || 'codex';
    last = join(mkdtempSync(join(tmpdir(), 'ccb-last-')), 'last.txt');
    args = ['exec', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--output-last-message', last, ...(session ? ['resume', id, '-'] : ['-C', cwd, '-'])];
  }
  let command = bin, argv = args;
  if (platform() === 'darwin' && existsSync('/usr/bin/sandbox-exec')) { profile ||= sandboxProfile(); command = '/usr/bin/sandbox-exec'; argv = ['-f', profile, bin, ...args]; }
  const out = spawnSync(command, argv, { cwd, env: childEnv, input: prompt, encoding: 'utf8', timeout, shell: win, maxBuffer: 64 * 1024 * 1024 });
  let text = out.stdout || '';
  if (provider === 'codex') {
    if (!id) id = (text.match(/"thread_id":"([^"]+)"/) || [])[1] || null;
    text = last && existsSync(last) ? readFileSync(last, 'utf8') : '';
  }
  return { provider, text: text.trim(), status: out.status, error: out.error?.message || null, stderr: (out.stderr || '').slice(-2000), seconds: Math.round((Date.now() - started) / 1000), session: { id }, command: `${bin} ${args.map(a => a === last ? '<last-message-file>' : a).join(' ')} <prompt on stdin>` };
}
