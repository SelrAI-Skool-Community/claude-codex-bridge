# Setup: bridge your Claude Code and Codex setup

One page, one prompt. The same prompt sets the bridge up the first time, updates
it later, and syncs it after that.

**How to use it:** open Claude Code or Codex on your Mac or Windows computer,
in a task that can read and write your files. Copy the prompt below, paste it
in, and press Enter. You need an account for the app you chose; the other app
is optional and can be added any time.

**Time:** allow 10 minutes for a first setup. Downloads take most of that.

---

## The prompt

I am setting up (or updating) the Claude + Codex Bridge by Selr AI.

Do these steps one at a time, telling me what you are doing in plain English.
Detect whether this session is Claude Code or Codex, whether it runs in a
desktop app or a terminal, and whether I am on Mac or Windows. Use the actual
session context; an installed app is not proof it hosts this session. If you
cannot tell, ask me that one question. Work from any folder; do not ask me to
move.

Downloads are the slow part. Before every download, tell me it can take a few
minutes on slow wifi and may look frozen without being frozen; prefer commands
that print progress; give slow commands a generous timeout so a dead download
fails loudly; afterwards confirm it worked or say plainly what failed.

### Step 1: preflight

1. `node --version`. If missing, install Node LTS: on Mac use nvm
   (`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash`,
   then `nvm install --lts`); on Windows use
   `winget install --id OpenJS.NodeJS.LTS -e --source winget`, then refresh
   PATH in this session with
   `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')`.
2. `git --version`. If missing: Mac `xcode-select --install` (I click
   Install); Windows `winget install --id Git.Git -e --source winget` and the
   same PATH refresh.

### Step 2: get the kit

The kit lives at `~/.selr/claude-codex-bridge` (`$HOME\.selr\claude-codex-bridge`
on Windows). If that folder is a git checkout, `git pull` inside it; otherwise
`git clone https://github.com/SelrAI-Skool-Community/claude-codex-bridge.git`
into it. Then run `node <kit>/scripts/bridge.mjs inspect --provider <claude|codex> --host <desktop|cli>`
and tell me what it found: which apps, how many skills, commands and
connections, and what it will never touch (credentials, private memory,
chats).

### Step 3: read the bridge skill and follow it

Read `<kit>/skills/claude-codex-bridge/SKILL.md` and follow its "Bridge or
sync" steps: plan, show me the plan grouped by what is shared, Claude-only,
Codex-only, translated and unsupported, ask me about anything that needs my
choice, get my approval of the plan id, apply it, verify it, and tell me the
steps that are mine (for example a native `/import` command). If the plan says
an earlier operation stopped part-way, plan and apply again; it continues from
its saved progress.

### Step 4: finish

Tell me to start a new task in each app I use, and what to say to check the
bridge is live: "What does the bridge give you?" should get an answer that names
the portable instructions, this app's overlay and the shared knowledge store.
