import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactContent } from '../redaction-engine.js';

export function redactCommand(args) {
  // Parse --check flag
  const hasCheck = args.includes('--check');
  if (!hasCheck) {
    throw new Error('redact requires --check flag. Usage: mem-sync redact --check');
  }

  const memSyncHome = process.env.MEM_SYNC_HOME ?? '.mem-sync';
  const storePath = join(memSyncHome, 'memories.jsonl');

  // Read JSONL line by line
  let raw;
  try {
    raw = readFileSync(storePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // No memories file — nothing to scan
      console.log(JSON.stringify({ ok: true, scanned: 0, findings: [] }));
      return;
    }
    throw err;
  }

  const lines = raw.split('\n');
  const findings = [];
  let scanned = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }

    scanned += 1;
    const content = record.content ?? record.text ?? '';
    const result = redactContent(content);

    if (result.matches.length > 0) {
      for (const match of result.matches) {
        findings.push({
          line: i + 1,
          id: record.id ?? null,
          rule: match.rule,
          severity: match.severity ?? result.severity,
        });
      }
    }
  }

  const ok = findings.filter(f => f.severity === 'block').length === 0;
  console.log(JSON.stringify({ ok, scanned, findings }, null, 2));
}
