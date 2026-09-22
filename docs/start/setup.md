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
Decide whether this session is Claude Code or Codex, whether it runs in a
desktop app or a terminal, and whether I am on Mac or Windows, from the
session's own context (your tool set and the app identity you can see) rather
than from what is installed on disk. If undecided, ask me that one question.
Work from the current folder.

Downloads are the slow part. Before every download, tell me it can take a few
minutes on slow wifi and may look stalled while still working; prefer commands
that print progress; give slow commands a generous timeout so a dead download
fails loudly; afterwards confirm it worked or say plainly what failed.

### Step 1: preflight

1. `node --version`. If missing, install Node LTS: on Mac install the current
   nvm script from github.com/nvm-sh/nvm (Installing and Updating), then
   `nvm install --lts`; on Windows use
   `winget install --id OpenJS.NodeJS.LTS -e --source winget`, then refresh
   PATH in this session with
   `$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')`.
2. `git --version`. If missing: Mac `xcode-select --install` (I click
   Install); Windows `winget install --id Git.Git -e --source winget` and the
   same PATH refresh.

### Step 2: get the kit

The kit home is `~/.selr/claude-codex-bridge` (`$HOME\.selr\claude-codex-bridge`
on Windows). If that folder is a git checkout, `git pull` inside it; otherwise
`git clone https://github.com/SelrAI-Skool-Community/claude-codex-bridge.git`
into it.

### Step 3: follow the bridge skill

Read `<kit home>/skills/claude-codex-bridge/SKILL.md` and follow its "Bridge
or sync" section from step 1 to done. The plan id you show me is the one I
approve.

### Step 4: check

Tell me what to say in a new task in each app to check the bridge is live:
"What does the bridge give you?" should get an answer that names the portable
instructions, this app's overlay and the shared knowledge store.
