import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DB_FILENAME = 'index.sqlite';

/**
 * Compute cosine similarity between two Float32Array vectors.
 * Returns a number in [-1, 1]. Returns 0 for zero-vectors.
 */
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length.');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Convert Float32Array to Buffer for SQLite BLOB storage.
 * Uses safe form to avoid including extra bytes from underlying ArrayBuffer.
 */
export function float32ToBlob(vec) {
  return Buffer.from(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength));
}

/**
 * Convert Buffer (from SQLite BLOB) back to Float32Array.
 * Uses safe form accounting for Buffer's byteOffset and byteLength.
 */
export function blobToFloat32(buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/**
 * Insert embeddings into the embeddings table.
 * Uses INSERT OR REPLACE wrapped in a transaction for performance.
 */
export function insertEmbeddings(db, memoryRowids, vectors, model, dimensions) {
  // Ensure the embeddings table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS embeddings (
      memory_rowid INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO embeddings (memory_rowid, model, dimensions, vector, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  const insertAll = db.transaction((rowids, vecs) => {
    for (let i = 0; i < rowids.length; i++) {
      stmt.run(rowids[i], model, dimensions, float32ToBlob(vecs[i]), now);
    }
  });

  insertAll(memoryRowids, vectors);
}

/**
 * Query embeddings by memory rowids.
 * Returns Map<number, Float32Array> — rowid → vector.
 * Missing rowids are simply not in the map.
 */
export function queryEmbeddings(db, memoryRowids) {
  const result = new Map();

  if (memoryRowids.length === 0) return result;

  // Check if the embeddings table exists
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings';"
  ).get();

  if (!tableCheck) return result;

  const placeholders = memoryRowids.map(() => '?').join(', ');
  const stmt = db.prepare(
    `SELECT memory_rowid, vector FROM embeddings WHERE memory_rowid IN (${placeholders})`
  );

  const rows = stmt.all(...memoryRowids);
  for (const row of rows) {
    result.set(row.memory_rowid, blobToFloat32(row.vector));
  }

  return result;
}

/**
 * Compute a hybrid search score combining BM25 rank and cosine similarity.
 *
 * @param {number} bm25Rank — negative = better (from FTS5)
 * @param {number} cosineSim — [-1, 1]
 * @param {number} [weight=0.4] — weight for BM25 component [0, 1]
 * @returns {number}
 */
export function computeHybridScore(bm25Rank, cosineSim, weight = 0.4) {
  const bm25Component = 1 / (1 + Math.abs(bm25Rank));
  const cosineComponent = Math.max(0, cosineSim);
  return weight * bm25Component + (1 - weight) * cosineComponent;
}

/**
 * Get embedding status from the index database.
 * Returns { count, model, dimensions, exists }.
 */
export function getEmbeddingStatus(cacheDir) {
  const dbPath = join(cacheDir, DB_FILENAME);

  if (!existsSync(dbPath)) {
    return { count: 0, model: null, dimensions: null, exists: false };
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode=WAL');
  db.pragma('busy_timeout=5000');

  let count = 0;
  let model = null;
  let dimensions = null;
  let exists = true;

  try {
    // Check if embeddings table exists
    const tableCheck = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings';"
    ).get();

    if (!tableCheck) {
      exists = false;
    } else {
      // Count actual rows
      const countResult = db.prepare('SELECT COUNT(*) as count FROM embeddings;').get();
      count = countResult.count;

      // Read metadata from index_meta
      const modelResult = db.prepare(
        "SELECT value FROM index_meta WHERE key = 'embedding_model';"
      ).get();
      model = modelResult?.value ?? null;

      const dimResult = db.prepare(
        "SELECT value FROM index_meta WHERE key = 'embedding_dimensions';"
      ).get();
      dimensions = dimResult?.value ? Number(dimResult.value) : null;
    }
  } finally {
    db.close();
  }

  return { count, model, dimensions, exists };
}
