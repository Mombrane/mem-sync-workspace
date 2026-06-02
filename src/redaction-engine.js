import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Built-in secret detection patterns.
 */
export const DEFAULT_PATTERNS = [
  {
    name: 'api-key',
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]([A-Za-z0-9_\-]{16,})['"]/i,
    severity: 'block',
  },
  {
    name: 'github-token',
    regex: /\b(ghp_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}|ghu_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9]{36,}|ghr_[A-Za-z0-9]{36,})\b/,
    severity: 'block',
  },
  {
    name: 'aws-key',
    regex: /\b(AKIA[A-Z0-9]{16})\b/,
    severity: 'block',
  },
  {
    name: 'private-key',
    regex: /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/,
    severity: 'block',
  },
  {
    name: 'password',
    regex: /(?:password|passwd|pwd)\s*[:=]/i,
    severity: 'block',
  },
  {
    name: 'jwt-token',
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    severity: 'block',
  },
  {
    name: 'mongodb-connection',
    regex: /mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/,
    severity: 'block',
  },
];

/**
 * Load redaction rules from repo. Merges with DEFAULT_PATTERNS.
 * @param {string} repoPath
 * @returns {Array<{name: string, regex: RegExp, severity: string}>}
 */
export function loadRedactionRules(repoPath) {
  const rulesPath = join(repoPath, 'meta', 'redaction-rules.json');

  if (!existsSync(rulesPath)) {
    return [...DEFAULT_PATTERNS];
  }

  let raw;
  try {
    raw = readFileSync(rulesPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read redaction rules: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Malformed redaction-rules.json: invalid JSON`);
  }

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rules)) {
    throw new Error('Malformed redaction-rules.json: expected { version: 1, rules: [...] }');
  }

  const custom = parsed.rules.map((r) => {
    if (!r.name || !r.pattern) {
      throw new Error(`Invalid custom rule: missing name or pattern`);
    }
    const flags = r.flags || '';
    let regex;
    try {
      regex = new RegExp(r.pattern, flags);
    } catch (err) {
      throw new Error(`Invalid regex in rule "${r.name}": ${err.message}`);
    }
    return {
      name: r.name,
      regex,
      severity: r.severity || 'block',
    };
  });

  return [...DEFAULT_PATTERNS, ...custom];
}

/**
 * Scan content against redaction rules.
 * @param {string} content
 * @param {Array} [rules]
 * @returns {{ blocked: boolean, severity: string|null, matches: Array<{rule: string, match: string, index: number}> }}
 */
export function redactContent(content, rules) {
  if (content === null || content === undefined) {
    return { blocked: false, severity: null, matches: [] };
  }

  if (typeof content !== 'string') {
    throw new TypeError('content must be a string');
  }

  if (content === '') {
    return { blocked: false, severity: null, matches: [] };
  }

  const activeRules = rules ?? DEFAULT_PATTERNS;
  const matches = [];
  let highestSeverity = null;

  for (const rule of activeRules) {
    const m = rule.regex.exec(content);
    if (m) {
      matches.push({
        rule: rule.name,
        match: m[0],
        index: m.index,
      });
      if (highestSeverity !== 'block') {
        highestSeverity = rule.severity;
      }
    }
  }

  return {
    blocked: highestSeverity === 'block',
    severity: highestSeverity,
    matches,
  };
}
