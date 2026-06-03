# Design: CLI Compatibility & README Consistency Fix

## Changes

### 1. Add `add` alias in `src/cli.js`

Add a new `else if` branch before the `else` (help) block:

```js
} else if (command === 'add') {
  await rememberCommand(args);
}
```

This routes `mem-sync add <content>` to `rememberCommand` with all the same flags.

### 2. Fix README.md

**Quick Start section:** Change `add` to `remember`:
```bash
node ./src/cli.js remember "User prefers concise Chinese replies" --scope assistant --source codex
```

**Remove outdated roadmap paragraph** (lines 60-62):
```
The current prototype still stores memories in `.mem-sync/memories.json`. The next implementation phase migrates the source of truth to Git-friendly JSONL files, then layers local FTS recall and Git sync on top.
```
Replace with a brief note that JSONL is the current format.

### 3. Fix DEFAULT_REPO in 4 command files

Each file has:
```js
const DEFAULT_REPO = path.join(HOME, '.memcli', 'default');
```

Change to:
```js
const DEFAULT_REPO = path.join(process.cwd(), process.env.MEM_SYNC_HOME ?? '.mem-sync');
```

This aligns with how other commands resolve the repo path.

### 4. Add tests/cli-alias.test.js

Test that `mem-sync add "test content"` works identically to `mem-sync remember "test content"` — same output format, same store path, same schema normalization.
