/**
 * Pure extraction engine for the `retain --pending` command.
 *
 * Extracts candidate memories from agent session transcripts
 * using data-driven, rule-based pattern matching.
 *
 * No I/O, no side effects — candidates are partial memory inputs
 * that the command layer normalizes via normalizeMemoryInput.
 */

/**
 * Extract the meaningful sentence after a trigger word/phrase.
 * If the pattern matches and has a non-empty capture group,
 * returns the captured text; otherwise returns the full content.
 *
 * @param {string} content - full message content
 * @param {RegExp} pattern - regex with optional capture group
 * @returns {string} extracted sentence (trimmed)
 */
function extractSentence(content, pattern) {
  const match = content.match(pattern);
  if (match && match[1] && match[1].trim()) {
    return match[1].trim();
  }
  return content;
}

const RULES = [
  {
    name: 'explicit-remember',
    test: (msg) => /(?:记住|remember|请记住|记一下)/i.test(msg.content),
    extract: (msg, _options) => ({
      content: extractSentence(msg.content, /(?:记住|remember|请记住|记一下)[:：]?\s*(.*)/i),
      kind: 'preference',
      scope: 'personal',
      confidence: 0.95,
      veracity: 'stated'
    })
  },
  {
    name: 'preference-pattern',
    test: (msg) => /(?:以后|默认|不要|总是|always|never|default)/i.test(msg.content),
    extract: (msg, _options) => ({
      content: msg.content,
      kind: 'preference',
      scope: 'personal',
      confidence: 0.85,
      veracity: 'stated'
    })
  },
  {
    name: 'decision-pattern',
    test: (msg) => /(?:决定|采用|选择|decided|chose|adopted)/i.test(msg.content),
    extract: (msg, options) => ({
      content: msg.content,
      kind: 'decision',
      scope: options.projectId ? 'project' : 'global',
      confidence: 0.8,
      veracity: 'stated'
    })
  },
  {
    name: 'project-fact-pattern',
    test: (msg) => /(?:架构|命令|坑点|constraint|architecture|pitfall)/i.test(msg.content),
    extract: (msg, options) => ({
      content: msg.content,
      kind: 'project_fact',
      scope: options.projectId ? 'project' : 'global',
      confidence: 0.6,
      veracity: 'inferred'
    })
  }
];

/**
 * Extract candidate memories from a transcript.
 * Pure function — no I/O, no side effects.
 *
 * @param {Array<{role: string, content: string}>} transcript
 * @param {{ projectId?: string, agentId?: string, now?: Date }} options
 * @returns {Array<Object>} candidates — partial memory inputs for normalizeMemoryInput
 */
export function extractCandidates(transcript, options = {}) {
  if (!Array.isArray(transcript)) {
    throw new Error('transcript must be an array.');
  }

  const candidates = [];

  for (const msg of transcript) {
    // Only process user messages — skip assistant, system, and malformed entries
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'user') continue;
    if (typeof msg.content !== 'string' || !msg.content.trim()) continue;

    let matched = false;

    for (const rule of RULES) {
      if (rule.test(msg)) {
        const extracted = rule.extract(msg, options);
        candidates.push({
          content: extracted.content,
          kind: extracted.kind,
          scope: extracted.scope,
          confidence: extracted.confidence,
          veracity: extracted.veracity,
          source: {
            type: 'retain',
            agent: options.agentId ?? null
          },
          evidence: [{
            type: 'user_message',
            text: msg.content
          }],
          projectId: options.projectId ?? null,
          now: options.now ?? new Date()
        });
        matched = true;
      }
    }

    // Fallback: unmatched user messages get an episode candidate
    if (!matched) {
      candidates.push({
        content: msg.content,
        kind: 'episode',
        scope: 'global',
        confidence: 0.3,
        veracity: 'inferred',
        source: {
          type: 'retain',
          agent: options.agentId ?? null
        },
        evidence: [{
          type: 'user_message',
          text: msg.content
        }],
        projectId: options.projectId ?? null,
        now: options.now ?? new Date()
      });
    }
  }

  return candidates;
}
