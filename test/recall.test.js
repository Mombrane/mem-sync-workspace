import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecallArgs, recallCommand } from '../src/commands/recall.js';
import { float32ToBlob } from '../src/embedding-cache.js';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Create a minimal test DB matching the real index-store schema.
 * Returns { tmpDir, cacheDir } for MEM_SYNC_HOME setup.
 */
function createTestDb(memories = [], embedRows = []) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'recall-test-'));
  const cacheDir = join(tmpDir, '.cache');
  mkdirSync(cacheDir, { recursive: true });

  const db = new Database(join(cacheDir, 'index.sqlite'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT,
      agent_id TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      source_json TEXT,
      evidence_json TEXT,
      confidence REAL DEFAULT 0.5,
      importance REAL DEFAULT 0.5,
      veracity TEXT DEFAULT 'unknown',
      tags_json TEXT,
      created_at TEXT,
      updated_at TEXT,
      valid_until TEXT,
      deleted_at TEXT,
      supersedes_json TEXT,
      file_path TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      repo_commit TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, summary, tags_json,
      tokenize='trigram',
      content='memories',
      content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      memory_rowid INTEGER PRIMARY KEY,
      vector BLOB NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_rowid) REFERENCES memories(rowid) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT OR REPLACE INTO index_meta (key, value) VALUES ('repo_head', 'test');
  `);

  const insertMem = db.prepare(`
    INSERT INTO memories (id, kind, scope, content, summary, tags_json, confidence, importance, veracity, created_at, updated_at, file_path, line_no, repo_commit)
    VALUES (@id, @kind, @scope, @content, @summary, @tags_json, @confidence, @importance, @veracity, @created_at, @updated_at, @file_path, @line_no, @repo_commit)
  `);

  const insertFts = db.prepare(`
    INSERT INTO memories_fts (rowid, content, summary, tags_json)
    VALUES (@rowid, @content, @summary, @tags_json)
  `);

  const insertEmbed = db.prepare(`
    INSERT INTO embeddings (memory_rowid, vector, model, dimensions, created_at)
    VALUES (@memory_rowid, @vector, @model, @dimensions, @created_at)
  `);

  for (const m of memories) {
    const info = insertMem.run({
      id: m.id,
      kind: m.kind ?? 'fact',
      scope: m.scope ?? 'global',
      content: m.content,
      summary: m.summary ?? null,
      tags_json: m.tags_json ?? '[]',
      confidence: m.confidence ?? 0.9,
      importance: m.importance ?? 0.8,
      veracity: m.veracity ?? 'true',
      created_at: m.created_at ?? '2025-01-01T00:00:00Z',
      updated_at: m.updated_at ?? '2025-01-01T00:00:00Z',
      file_path: m.file_path ?? 'memories/test.jsonl',
      line_no: m.line_no ?? 1,
      repo_commit: m.repo_commit ?? 'abc123',
    });
    // Insert into FTS for trigram tokenizer (external content mode requires manual sync)
    insertFts.run({
      rowid: info.lastInsertRowid,
      content: m.content,
      summary: m.summary ?? null,
      tags_json: m.tags_json ?? '[]',
    });
  }

  for (const e of embedRows) {
    insertEmbed.run({
      memory_rowid: e.rowid,
      vector: e.vector,
      model: 'mock',
      dimensions: e.dimensions ?? 32,
      created_at: '2025-01-01T00:00:00Z',
    });
  }

  db.close();
  return { tmpDir, cacheDir };
}

// ─── parseRecallArgs: --mode flag ──────────────────────────────────────

describe('parseRecallArgs — --mode flag', () => {
  it('parses --mode fts', () => {
    const result = parseRecallArgs(['--mode', 'fts', 'hello']);
    assert.equal(result.mode, 'fts');
    assert.equal(result.query, 'hello');
  });

  it('parses --mode hybrid', () => {
    const result = parseRecallArgs(['--mode', 'hybrid', 'test query']);
    assert.equal(result.mode, 'hybrid');
    assert.equal(result.query, 'test query');
  });

  it('parses --mode semantic', () => {
    const result = parseRecallArgs(['--mode', 'semantic', 'query']);
    assert.equal(result.mode, 'semantic');
  });

  it('throws on invalid --mode value', () => {
    assert.throws(
      () => parseRecallArgs(['--mode', 'invalid', 'query']),
      /--mode/
    );
  });

  it('throws when --mode has no value', () => {
    assert.throws(
      () => parseRecallArgs(['--mode']),
      /--mode/
    );
  });

  it('mode is undefined when --mode not specified', () => {
    const result = parseRecallArgs(['hello']);
    assert.equal(result.mode, undefined);
  });

  it('works alongside --limit', () => {
    const result = parseRecallArgs(['--mode', 'hybrid', '--limit', '5', 'query']);
    assert.equal(result.mode, 'hybrid');
    assert.equal(result.limit, 5);
    assert.equal(result.query, 'query');
  });

  it('works alongside --scope', () => {
    const result = parseRecallArgs(['--mode', 'fts', '--scope', 'global', 'q']);
    assert.equal(result.mode, 'fts');
    assert.equal(result.scope, 'global');
  });
});

// ─── recallCommand: mode routing ──────────────────────────────────────

describe('recallCommand — --mode flag routing', () => {
  let origEnv;
  let stderrOutput;
  let stdoutOutput;
  let origStderrWrite;
  let origStdoutWrite;

  beforeEach(() => {
    origEnv = { ...process.env };
    stderrOutput = '';
    stdoutOutput = '';
    origStderrWrite = process.stderr.write.bind(process.stderr);
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = (chunk) => {
      stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    };
    process.stdout.write = (chunk) => {
      stdoutOutput += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    };
  });

  afterEach(() => {
    process.env = { ...origEnv };
    process.stderr.write = origStderrWrite;
    process.stdout.write = origStdoutWrite;
  });

  it('--mode fts uses BM25 search (no regression)', async () => {
    const { tmpDir } = createTestDb([
      { id: 'mem-1', content: 'hello world testing', summary: 'greeting' },
    ]);

    const origHome = process.env.MEM_SYNC_HOME;
    process.env.MEM_SYNC_HOME = tmpDir;

    try {
      await recallCommand(['--mode', 'fts', 'hello']);

      assert.ok(stdoutOutput.includes('Recall:'), 'should contain recall header');
      assert.ok(stdoutOutput.includes('mem-1'), 'should contain memory id');
      assert.ok(stdoutOutput.includes('BM25'), 'should show BM25 score label');
      assert.ok(!stdoutOutput.includes('Hybrid'), 'should not show Hybrid label');
    } finally {
      if (origHome !== undefined) process.env.MEM_SYNC_HOME = origHome;
      else delete process.env.MEM_SYNC_HOME;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--mode hybrid with MEM_SYNC_EMBEDDING_PROVIDER=mock uses hybrid search', async () => {
    // Create a mock embedding for the memory
    const dims = 32;
    const v = new Float32Array(dims);
    for (let i = 0; i < dims; i++) {
      v[i] = Math.sin(('hello world testing'.length + 1) * (i + 1) * 0.1);
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    for (let i = 0; i < dims; i++) v[i] /= norm;
    const blob = float32ToBlob(v);

    const { tmpDir } = createTestDb(
      [{ id: 'mem-h1', content: 'hello world testing', summary: 'greeting' }],
      [{ rowid: 1, vector: blob, dimensions: dims }]
    );

    const origHome = process.env.MEM_SYNC_HOME;
    const origProvider = process.env.MEM_SYNC_EMBEDDING_PROVIDER;
    process.env.MEM_SYNC_HOME = tmpDir;
    process.env.MEM_SYNC_EMBEDDING_PROVIDER = 'mock';

    try {
      await recallCommand(['--mode', 'hybrid', 'hello']);

      assert.ok(stdoutOutput.includes('Recall:'), 'should contain recall header');
      assert.ok(stdoutOutput.includes('mem-h1'), 'should contain memory id');
      assert.ok(stdoutOutput.includes('Hybrid'), 'should contain Hybrid score label, got: ' + stdoutOutput);
      assert.ok(stdoutOutput.includes('hybrid='), 'should contain hybrid score value');
    } finally {
      if (origHome !== undefined) process.env.MEM_SYNC_HOME = origHome;
      else delete process.env.MEM_SYNC_HOME;
      if (origProvider !== undefined) process.env.MEM_SYNC_EMBEDDING_PROVIDER = origProvider;
      else delete process.env.MEM_SYNC_EMBEDDING_PROVIDER;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--mode hybrid without provider env falls back to FTS with warning', async () => {
    const { tmpDir } = createTestDb([
      { id: 'mem-h2', content: 'fallback test query', summary: 'test' },
    ]);

    const origHome = process.env.MEM_SYNC_HOME;
    const origProvider = process.env.MEM_SYNC_EMBEDDING_PROVIDER;
    process.env.MEM_SYNC_HOME = tmpDir;
    // noop provider returns dimensions=0 → falls back to FTS
    process.env.MEM_SYNC_EMBEDDING_PROVIDER = 'noop';

    try {
      await recallCommand(['--mode', 'hybrid', 'fallback']);

      assert.ok(
        stderrOutput.includes('not configured') || stderrOutput.includes('Falling back'),
        'stderr should contain fallback warning, got: ' + stderrOutput
      );
      assert.ok(stdoutOutput.includes('Recall:'), 'should contain recall header');
      assert.ok(stdoutOutput.includes('BM25'), 'should use BM25 score label');
      assert.ok(!stdoutOutput.includes('Hybrid'), 'should not use Hybrid label');
    } finally {
      if (origHome !== undefined) process.env.MEM_SYNC_HOME = origHome;
      else delete process.env.MEM_SYNC_HOME;
      if (origProvider !== undefined) process.env.MEM_SYNC_EMBEDDING_PROVIDER = origProvider;
      else delete process.env.MEM_SYNC_EMBEDDING_PROVIDER;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('--mode semantic throws not-implemented error', async () => {
    const { tmpDir } = createTestDb([
      { id: 'mem-s1', content: 'semantic test', summary: 'test' },
    ]);

    const origHome = process.env.MEM_SYNC_HOME;
    process.env.MEM_SYNC_HOME = tmpDir;

    try {
      await assert.rejects(
        () => recallCommand(['--mode', 'semantic', 'test']),
        { message: '--mode semantic is not yet implemented.' }
      );
    } finally {
      if (origHome !== undefined) process.env.MEM_SYNC_HOME = origHome;
      else delete process.env.MEM_SYNC_HOME;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('invalid --mode value throws error', () => {
    assert.throws(
      () => parseRecallArgs(['--mode', 'bogus', 'query']),
      /--mode/
    );
  });

  it('--mode works with --limit', async () => {
    const { tmpDir } = createTestDb([
      { id: 'mem-l1', content: 'limit test alpha', summary: 'alpha' },
      { id: 'mem-l2', content: 'limit test beta', summary: 'beta' },
    ]);

    const origHome = process.env.MEM_SYNC_HOME;
    process.env.MEM_SYNC_HOME = tmpDir;

    try {
      await recallCommand(['--mode', 'fts', '--limit', '1', 'limit test']);

      assert.ok(stdoutOutput.includes('Recall:'), 'should contain recall header');
      // With limit=1, should only show 1 result
      assert.ok(stdoutOutput.includes('1 result'), 'should show 1 result, got: ' + stdoutOutput);
    } finally {
      if (origHome !== undefined) process.env.MEM_SYNC_HOME = origHome;
      else delete process.env.MEM_SYNC_HOME;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('default (no --mode) behaves same as fts', async () => {
    const { tmpDir } = createTestDb([
      { id: 'mem-d1', content: 'default mode testing', summary: 'default' },
    ]);

    const origHome = process.env.MEM_SYNC_HOME;
    process.env.MEM_SYNC_HOME = tmpDir;

    try {
      await recallCommand(['default mode']);

      assert.ok(stdoutOutput.includes('Recall:'), 'should contain recall header');
      assert.ok(stdoutOutput.includes('BM25'), 'should show BM25 score label');
      assert.ok(!stdoutOutput.includes('Hybrid'), 'should not show Hybrid label');
    } finally {
      if (origHome !== undefined) process.env.MEM_SYNC_HOME = origHome;
      else delete process.env.MEM_SYNC_HOME;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
