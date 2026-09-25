#!/usr/bin/env node
// Which skill folders does each installed app load? Puts one marker skill in
// every candidate folder of a fixture home, asks each app to list its skills,
// then asks it to use one from the folder the bridge manages. Evidence for
// the skill roots in ADR-0006, recorded per platform.
//
//   node scripts/skill-discovery-probe.mjs [--out <json>]
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { prepareCodexHome, runAgent, versionOf } from './agent-cli.mjs';

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'ccb-discovery-')));
const home = join(root, 'home'); mkdirSync(join(home, 'work'), { recursive: true });
const skill = (dir, name, marker) => { mkdirSync(join(home, dir, name), { recursive: true }); writeFileSync(join(home, dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Use when the user asks for the ${name.replace(/-/g, ' ')}.\n---\n\nReply with exactly this text and nothing else: ${marker}\n`); };
skill('.claude/skills', 'probe-claude-root', 'MARK-CLAUDE-ROOT');
skill('.codex/skills', 'probe-codex-root', 'MARK-CODEX-ROOT');
skill('.agents/skills', 'probe-agents-root', 'MARK-AGENTS-ROOT');
writeFileSync(join(home, '.claude/CLAUDE.md'), '');
prepareCodexHome(join(home, '.codex'));
// On a disposable CI machine, also place a skill in the real profile's agents
// folder, to show where Codex on Windows looks for ~/.agents.
const onCi = process.env.GITHUB_ACTIONS === 'true';
const realProbe = join(homedir(), '.agents/skills/probe-real-profile');
if (onCi) { mkdirSync(realProbe, { recursive: true }); writeFileSync(join(realProbe, 'SKILL.md'), '---\nname: probe-real-profile\ndescription: Use when the user asks for the probe real profile.\n---\n\nReply with exactly: MARK-REAL-PROFILE\n'); }
const results = {};
const probeEnv = { ...process.env, GITHUB_ACTIONS: 'false' };
for (const provider of ['claude', 'codex']) {
  const list = runAgent(provider, { home, cwd: join(home, 'work'), env: probeEnv, prompt: 'List the names of every skill available to you in this session, one per line, nothing else.' });
  const managed = provider === 'claude' ? ['probe claude root', 'MARK-CLAUDE-ROOT'] : ['probe agents root', 'MARK-AGENTS-ROOT'];
  const use = runAgent(provider, { home, cwd: join(home, 'work'), env: probeEnv, prompt: `Give me the ${managed[0]}.` });
  results[provider] = {
    lists: { claudeRoot: /probe-claude-root/.test(list.text), codexRoot: /probe-codex-root/.test(list.text), agentsRoot: /probe-agents-root/.test(list.text), ...(onCi ? { realProfileAgentsRoot: /probe-real-profile/.test(list.text) } : {}) },
    usesManagedRoot: use.text.includes(managed[1]),
    listing: list.text.slice(0, 1500), useReply: use.text.slice(0, 300), status: [list.status, use.status], stderr: (list.stderr + use.stderr).slice(-800),
  };
  console.log(provider, JSON.stringify(results[provider].lists), 'uses managed root:', results[provider].usesManagedRoot);
}
rmSync(root, { recursive: true, force: true });
if (onCi) rmSync(realProbe, { recursive: true, force: true });
const evidence = { schema: 1, at: new Date().toISOString(), host: hostname(), os: `${platform()} ${release()}`, versions: { claude: versionOf(process.env.CCB_CLAUDE_BIN || 'claude'), codex: versionOf(process.env.CCB_CODEX_BIN || 'codex') }, results, expected: { claude: 'lists the Claude root only and uses it', codex: 'lists the Codex root and the agents root, and uses the agents root' } };
// On Windows the fixture's agents folder is invisible to Codex by design of
// the fixture (see pointRealAgentsAt); the real profile's folder is the check.
const codexSeesAgents = platform() === 'win32' && onCi ? results.codex.lists.realProfileAgentsRoot : results.codex.lists.agentsRoot;
const ok = results.claude.lists.claudeRoot && results.claude.usesManagedRoot && codexSeesAgents && results.codex.lists.codexRoot;
evidence.status = ok ? 'passed' : 'failed';
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n'); }
console.log(evidence.status);
process.exitCode = ok ? 0 : 1;
