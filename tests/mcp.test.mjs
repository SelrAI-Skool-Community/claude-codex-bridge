import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { B, fixtureHome, item } from './helpers.mjs';
import { tomlTables } from '../scripts/bridge-adapters.mjs';

const SECRETS = ['ghp_FakeExampleTokenFakeExampleToken9876', 'Trellis-9-Quartz-Secret', 'sk_live_ABCDEFGHIJKLMNOP1234', 'xoxb-1234567890-abcdefghij', 'super-secret-cookie-value'];

test('MCP definitions are inventoried as metadata only: secret-bearing values never appear in plans, receipts, reports or the inventory', () => {
  const fx = fixtureHome('mcp');
  try {
    fx.seed('claude', { instructions: 'Hi.\n' });
    writeFileSync(join(fx.home, '.claude.json'), JSON.stringify({ mcpServers: {
      linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: `Bearer ${SECRETS[0]}` } },
      files: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], env: { API_TOKEN: SECRETS[1] } },
      tokenarg: { command: 'node', args: ['server.mjs', `--token=${SECRETS[2]}`] },
      keyed: { type: 'sse', url: `https://example.test/sse?api_key=${SECRETS[3]}` },
      plain: { command: 'uvx', args: ['weather-mcp'] },
    } }));
    fx.seed('codex', { instructions: 'Hi.\n', files: { 'config.toml': `model = "gpt-6-astra"\n\n[mcp_servers.node_repl]\ncommand = "node"\nargs = ["repl.mjs"]\n\n[mcp_servers.node_repl.env]\nSESSION_COOKIE = "${SECRETS[4]}"\n\n[mcp_servers.remote]\nurl = "https://mcp.example.test/mcp"\nbearer_token_env_var = "REMOTE_TOKEN"\n` } });
    const p = B.plan(fx);
    const text = JSON.stringify(p);
    for (const s of SECRETS) assert.ok(!text.includes(s), `plan leaked ${s.slice(0, 6)}`);
    assert.equal(item(p, 'mcp:claude/linear').disposition, 'translated');
    assert.deepEqual(item(p, 'mcp:claude/linear').metadata.redacted, ['headers']);
    assert.equal(item(p, 'mcp:claude/linear').metadata.url, 'https://mcp.linear.app/mcp');
    assert.equal(item(p, 'mcp:claude/linear').metadata.authRequired, true);
    assert.match(item(p, 'mcp:claude/linear').userAction, /sign in/);
    assert.deepEqual(item(p, 'mcp:claude/files').metadata.args, ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']);
    assert.deepEqual(item(p, 'mcp:claude/files').metadata.redacted, ['env']);
    assert.deepEqual(item(p, 'mcp:claude/tokenarg').metadata.redacted, ['args']);
    assert.equal(item(p, 'mcp:claude/tokenarg').metadata.args, undefined);
    assert.equal(item(p, 'mcp:claude/keyed').metadata.url, undefined, 'a URL carrying a key is withheld');
    assert.equal(item(p, 'mcp:claude/plain').metadata.authRequired, false);
    assert.deepEqual(item(p, 'mcp:codex/node_repl').metadata.redacted, ['env']);
    assert.deepEqual(item(p, 'mcp:codex/remote').metadata.redacted, ['bearer_token_env_var']);
    const result = B.apply(fx, p.id);
    for (const blob of [JSON.stringify(result), readFileSync(fx.corePath('mcp-inventory.json'), 'utf8'), JSON.stringify(fx.manifest()), JSON.stringify(B.verify(fx)), JSON.stringify(B.status(fx)), JSON.stringify(B.inspect(fx))]) for (const s of SECRETS) assert.ok(!blob.includes(s), `leaked ${s.slice(0, 6)}`);
    const inventory = JSON.parse(readFileSync(fx.corePath('mcp-inventory.json'), 'utf8'));
    assert.equal(inventory.servers.length, 7);
    assert.ok(inventory.servers.every(s => !('env' in s) && !('headers' in s)));
    assert.equal(fx.readText(join(fx.config('codex'), 'config.toml')).includes('[mcp_servers.linear]'), false, 'the bridge never writes MCP servers into a provider config');
    assert.equal(fx.readText(join(fx.home, '.claude.json')).includes('node_repl'), false);
    assert.ok(p.userSteps.some(s => s.includes('"linear"') && s.includes('codex')));
    assert.equal(B.plan(fx).noop, true, 'the inventory is stable');
  } finally { fx.cleanup(); }
});

test('the minimal TOML reader handles tables, quoted keys, arrays and inline tables without crashing', () => {
  const t = tomlTables('a = 1\n[mcp_servers."my server"]\ncommand = "x"\nargs = ["a", "b"]\nenv = { K = "v" }\n[mcp_servers.other.env]\nX = "y"\n');
  assert.deepEqual(Object.keys(t), ['mcp_servers.my server', 'mcp_servers.other.env']);
  assert.deepEqual(t['mcp_servers.my server'].args, ['a', 'b']);
  assert.deepEqual(t['mcp_servers.my server'].env, { inline: true });
});
