# mem-sync Skill

Multi-agent collaborative memory via Git-backed JSONL storage. This skill guides you through using `mem-sync` to read and write portable user memories that persist across agents and sessions.

## Quick check

Before doing anything, verify `mem-sync` is available:

```bash
which mem-sync || npm list -g mem-sync || echo "NOT_FOUND"
```

If not found, guide the user: `npm install -g` from the mem-sync project directory, or `npm link` inside a local clone.

---

## Phase 1: Initialize (first time only)

If `.mem-sync/` does not exist in or above the current working directory, the memory repo has not been set up yet. **You (the agent) should do all of the following yourself.** Do not ask the user to run commands manually.

### Step 1.1: Check prerequisites

```bash
which mem-sync && which git && which gh
```

If `mem-sync` is not found, install it:

```bash
ls /Users/$USER/workspace/mem-sync/package.json 2>/dev/null && \
  cd /Users/$USER/workspace/mem-sync && npm link
```

If `gh` is not found or not authenticated, tell the user to run `gh auth login` first.

### Step 1.2: Resolve the memory repository

Start by asking the user if they already have a memory repository:

> **header:** "Memory repo"
> **question:** Do you already have a GitHub repository for storing agent memories?

Options:
- **"Yes, I have one"** — you'll provide the SSH clone URL
- **"No, create one for me"** — I'll create a private GitHub repo for you

---

**If the user has an existing repo**, ask for the SSH URL (`git@github.com:owner/repo.git`). Use it directly:

```bash
mem-sync init --repo <user-provided-url>
```

This clones their existing memory store into `.mem-sync/`. If the repo already contains a `SKILL.md`, their prior agent configuration is preserved.

**If the user wants you to create one**, ask what they'd like to name it (suggest `agent-memory-store` as the default), then:

```bash
gh repo create <name> --private --clone=false
```

Use the resulting SSH URL: `git@github.com:<owner>/<name>.git`. But don't call `mem-sync init` yet — first ask the remaining configuration questions below.

### Step 1.3: Configure features (only for new repos)

For an **existing** repo, skip this step — the prior configuration is already in place.

For a **new** repo, ask these three questions. Use `AskUserQuestion`.

#### Q1: LLM Features

> **header:** "LLM"
> **question:** Enable LLM-powered features? (memory extraction from transcripts, hybrid semantic search, LLM reranking) Requires an OpenAI-compatible API key.

Options:
- **"Skip"** — FTS5 full-text search and rule-based extraction work fine without it
- **"Enable"** — I'll ask for your API key next

If "Enable", ask for API key, base URL (default `https://api.openai.com`), LLM model (default `gpt-4o-mini`), and embedding model (default `text-embedding-3-small`).

#### Q2: Review Workflow

> **header:** "Review"
> **question:** Should new memories go through manual review before taking effect?

Options:
- **"Review (Recommended)"** — Memories go to a pending queue, you approve or reject each one. Best for multi-agent setups.
- **"Auto-approve"** — Agent writes directly to the store. Simpler, no guardrail.

#### Q3: Encryption

> **header:** "Encryption"
> **question:** Encrypt memory data at rest? Requires `age` binary (`brew install age`).

Options:
- **"No encryption"** — Plain JSONL (Git-diff friendly, simplest)
- **"Encrypt with age keypair"** — Generate a keypair, encrypt with public key
- **"Encrypt with password"** — Encrypt with a password you provide each session

If user chooses encryption, check `which age` first. If missing, guide them to install it.

### Step 1.4: Run init (for new repos)

Now construct and run the command:

```bash
mem-sync init --repo <github-url>                                    # base
mem-sync init --repo <github-url> --encrypt                         # Q3 = keypair
mem-sync init --repo <github-url> --encrypt --password              # Q3 = password
```

This creates `.mem-sync/` with the full directory structure and an initial commit.

### Step 1.5: Copy SKILL.md into the memory repo

**This is critical.** The SKILL.md you are reading now lives in the mem-sync project directory. Copy it into `.mem-sync/` so other agents on other devices can discover it:

```bash
cp <path-to-mem-sync-project>/SKILL.md .mem-sync/SKILL.md
cd .mem-sync
git add SKILL.md
git commit -m "init: add agent skill guide"
```

If the repo is new, push for the first time:

```bash
cd .mem-sync && git push -u origin main
```

If the repo already existed (Step 1.2, "Yes I have one"), check whether it already has a SKILL.md. If not, add it. If it does, consider whether your local copy is newer and should replace it.

### Step 1.6: Save environment variables

For new repos with LLM enabled, tell the user to add these to their shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export MEM_SYNC_LLM_PROVIDER=openai
export MEM_SYNC_LLM_API_KEY=<key>
export MEM_SYNC_LLM_BASE_URL=<url>           # only if not default
export MEM_SYNC_LLM_MODEL=<model>            # only if not gpt-4o-mini
export MEM_SYNC_EMBEDDING_PROVIDER=openai
export MEM_SYNC_OPENAI_API_KEY=<key>
export MEM_SYNC_OPENAI_BASE_URL=<url>        # only if not default
export MEM_SYNC_OPENAI_MODEL=<model>         # only if not text-embedding-3-small
```

For existing repos, the prior configuration should already be in place. If LLM features were configured differently before, the existing env vars take precedence.

### Step 1.7: Verify

```bash
mem-sync status
mem-sync index rebuild
mem-sync summarize
```

All three should succeed. If anything fails, diagnose with `mem-sync doctor`. Once verified, tell the user:

> "Memory sync is ready. Your memories live in git@github.com:<owner>/<repo>.git. Other agents can join by running `mem-sync init --repo git@github.com:<owner>/<repo>.git` on their machine."

---

## Phase 2: Session Start (every session)

At the beginning of every session, run these in order:

```bash
# 1. Pull latest memories from GitHub
mem-sync sync

# 2. Load user context (profile + summary + project memories)
mem-sync context --mode startup --format markdown

# 3. Also load project-specific context if working in a project
mem-sync context --project . --format markdown
```

The `context` output is a Markdown summary of the user's profile, preferences, and recent project context. Use this to personalize your responses. **Do not show the raw output to the user** — just absorb it as background knowledge.

---

## Phase 3: During the Session

### When to save a memory

You should capture memories when the user:

- **Expresses a preference** ("I prefer TypeScript over JavaScript", "I like concise answers")
- **Makes a decision** ("Let's use PostgreSQL for this project")
- **Corrects your behavior** ("Don't summarize at the end of every response")
- **Shares background** ("I'm a data scientist with 10 years of Python experience")
- **Defines a workflow** ("Before each PR, run the full test suite")

### How to save (depends on the review mode set in Phase 1)

**Auto-approve mode:**
```bash
mem-sync remember "<content>" --kind <kind> --scope <scope> --confidence <0-1> --importance <0-1>
```

**Review mode (recommended):**
```bash
# First, ensure we have the latest
mem-sync prepare

# Write the candidate to pending
mem-sync retain --pending --transcript-file <transcript.json> --device <device-id>

# Then tell the user: "I've queued a memory for review. Run `mem-sync review pending` to see it."
```

### Kinds and scopes

**Kinds** (pick the best fit): `preference`, `decision`, `correction`, `fact`, `workflow`, `goal`, `constraint`, `relationship`, `warning`

**Scopes**: `personal` (about the user), `project` (about the current project), `global` (applies everywhere)

### Example: saving a preference

```bash
mem-sync remember "User prefers answers in Chinese, with code comments in English" \
  --kind preference --scope personal --confidence 0.9 --importance 0.7
```

### Looking up memories mid-session

When you need to recall something about the user:

```bash
# Full-text search
mem-sync recall "TypeScript preference" --format markdown

# Filtered search
mem-sync recall "database" --kind decision --scope project --project-id my-project --format markdown

# With LLM reranking (if LLM is enabled)
mem-sync recall "deployment strategy" --llm-rerank --format markdown
```

---

## Phase 4: Session End (opt-in, ask the user)

At the end of a session, **ask the user** before doing anything:

> "Before we wrap up — should I scan this session for new memories to save?"

If they say yes:

### 4a. Extract memories from the transcript

First, save the current session transcript as a JSON file (the format should be an array of `{ role, content }` objects), then:

```bash
mem-sync retain \
  --pending \
  --transcript-file ./session-transcript.json \
  --device <device-id>
```

If LLM is enabled, add `--llm-extract` for better extraction quality.

The output is an integer — the number of candidate memories found.

### 4b. Review (if review mode is on)

```bash
# Show pending memories to the user
mem-sync review pending --full

# User approves specific ones
mem-sync review approve <id>
# Or approve all
mem-sync review approve --all
```

### 4c. Push changes

```bash
# Full sync cycle: merge, commit, push, rebuild index
mem-sync flush
```

If LLM is enabled and the user wants richer context for future sessions:

```bash
# Regenerate profile and summaries
mem-sync summarize --force
mem-sync skills generate
mem-sync flush
```

---

## Phase 5: Maintenance (as needed)

These are less frequent but useful:

| Command | When to use |
|---|---|
| `mem-sync doctor` | Diagnose issues — run if anything feels off |
| `mem-sync status` | Quick overview of repo + pending + index state |
| `mem-sync compact` | Deduplicate old memories (run weekly or monthly) |
| `mem-sync redact --check` | Scan for accidentally stored secrets |
| `mem-sync log --limit 10` | See recent memory changes |
| `mem-sync show <id>` | Inspect a specific memory by ID |
| `mem-sync forget <id>` | Soft-delete a memory |
| `mem-sync index rebuild` | Rebuild FTS5 search index from scratch |

---

## Environment Reference

| Variable | Purpose | Required? |
|---|---|---|
| `MEM_SYNC_HOME` | Path to the memory repo | No (default `.mem-sync`) |
| `MEM_SYNC_LLM_PROVIDER` | `openai` for LLM features | Only if using LLM |
| `MEM_SYNC_LLM_API_KEY` | API key for LLM provider | Only if using LLM |
| `MEM_SYNC_LLM_BASE_URL` | Custom LLM API base URL | No |
| `MEM_SYNC_LLM_MODEL` | LLM model name | No (default `gpt-4o-mini`) |
| `MEM_SYNC_EMBEDDING_PROVIDER` | `openai` for hybrid search | Only if using hybrid search |
| `MEM_SYNC_OPENAI_API_KEY` | API key for embeddings | Only if using hybrid search |
| `MEM_SYNC_OPENAI_BASE_URL` | Custom embedding API URL | No |
| `MEM_SYNC_OPENAI_MODEL` | Embedding model | No (default `text-embedding-3-small`) |
| `MEM_SYNC_REVIEWER` | Reviewer identity | No (default `$USER`) |

---

## Error Recovery

- **Lock file stuck**: `rm .mem-sync/repo.lock` — the lock auto-expires after 300s, but can be removed manually.
- **Index out of sync**: `mem-sync index rebuild` — fully rebuilds from JSONL source.
- **Merge conflict in memories.jsonl**: resolve the conflict manually in the JSONL file, then `git add` and `mem-sync flush`.
- **Push rejected**: run `mem-sync sync` first to pull latest, resolve any conflicts, then `mem-sync flush` again.
