import fs from 'node:fs';
import path from 'node:path';
import { readJSONL } from './repo-store.js';
import { MEMORY_KINDS, normalizeContent } from './schema.js';

const MIN_WORKFLOW_COUNT = 2;
const MAX_STEPS = 10;
const SKILL_CONFIDENCE_THRESHOLD = 0.8;
const MIN_IMPORTANCE = 0.3;

const SKILL_CANDIDATE_KINDS = new Set(['workflow', 'decision', 'correction', 'warning']);

function computeScore(memory) {
  const importance = memory.importance || 0.5;
  const ageMs = Date.now() - new Date(memory.updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recency = Math.max(0, 1 - ageDays / 365);
  return importance * 0.6 + recency * 0.4;
}

function isValid(memory) {
  if (memory.deletedAt) return false;
  if (memory.validUntil && new Date(memory.validUntil) < new Date()) return false;
  return true;
}

/**
 * A memory is a skill candidate when it is valid, has sufficient confidence,
 * and belongs to a kind that carries process knowledge.
 */
function isSkillCandidate(memory) {
  if (!isValid(memory)) return false;
  if ((memory.confidence ?? 0) < SKILL_CONFIDENCE_THRESHOLD) return false;
  if ((memory.importance ?? 0) < MIN_IMPORTANCE) return false;
  if (!SKILL_CANDIDATE_KINDS.has(memory.kind)) return false;
  return true;
}

/**
 * Group memories by primary tag (the first tag), falling back to kind name.
 */
function groupByPrimaryTag(memories) {
  const groups = new Map();
  for (const m of memories) {
    const key = (m.tags && m.tags.length > 0) ? m.tags[0] : m.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  return groups;
}

/**
 * Convert a human-readable name into a filesystem-safe slug.
 * "Git Workflow" → "git-workflow"
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Convert a slug back to a human-readable title.
 * "git-workflow" → "Git Workflow"
 */
function titleCase(text) {
  return text
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(iso) {
  if (!iso) return 'unknown';
  return iso.slice(0, 10);
}

/**
 * Render a complete SKILL.md for a cluster of memories.
 */
function renderSkillMarkdown(clusterName, cluster, now) {
  const workflows = cluster.filter(m => m.kind === 'workflow');
  const decisions = cluster.filter(m => m.kind === 'decision');
  const corrections = cluster.filter(m => m.kind === 'correction');
  const warnings = cluster.filter(m => m.kind === 'warning');

  // Sort workflows by score descending, cap at MAX_STEPS
  const sortedWorkflows = workflows
    .map(m => ({ memory: m, score: computeScore(m) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_STEPS);

  const slug = slugify(clusterName);
  const title = titleCase(slug);
  const lines = [];

  // Frontmatter
  lines.push('---');
  lines.push(`name: ${slug}`);
  lines.push(`description: "Generated from ${cluster.length} memories about ${clusterName}"`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`Generated: ${now} | Sources: ${cluster.length} memories`);
  lines.push('');

  // Overview — highest-scored workflow
  if (sortedWorkflows.length > 0) {
    lines.push('## Overview');
    lines.push('');
    lines.push(normalizeContent(sortedWorkflows[0].memory.content));
    lines.push('');
  }

  // Steps / Pattern
  if (sortedWorkflows.length > 0) {
    lines.push('## Steps / Pattern');
    lines.push('');
    sortedWorkflows.forEach(({ memory }, index) => {
      lines.push(`${index + 1}. ${normalizeContent(memory.content)}`);
    });
    lines.push('');
  }

  // Related Decisions
  if (decisions.length > 0) {
    lines.push('## Related Decisions');
    lines.push('');
    for (const m of decisions) {
      const confidence = (m.confidence ?? 0.5).toFixed(2);
      lines.push(`- ${normalizeContent(m.content)} (confidence: ${confidence})`);
    }
    lines.push('');
  }

  // Corrections / Pitfalls
  const pitfalls = [...corrections, ...warnings];
  if (pitfalls.length > 0) {
    lines.push('## Corrections / Pitfalls');
    lines.push('');
    for (const m of pitfalls) {
      lines.push(`- ⚠️ ${normalizeContent(m.content)}`);
    }
    lines.push('');
  }

  // Source Memories
  lines.push('## Source Memories');
  lines.push('');
  for (const m of cluster) {
    const importance = (m.importance ?? 0.5).toFixed(2);
    const updated = formatDate(m.updatedAt);
    lines.push(`- ${m.id} (kind: ${m.kind}, importance: ${importance}, updated: ${updated})`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Generate SKILL.md files from memories, grouped by primary tag.
 *
 * Reads the same four memory sources as summarizeMemories, filters for
 * skill-candidate memories (workflow/decision/correction/warning with
 * confidence ≥ 0.8), groups by primary tag, and writes a SKILL.md for
 * each cluster that has at least MIN_WORKFLOW_COUNT workflow memories.
 *
 * @param {Object} opts
 * @param {string} opts.repoPath - path to memory repo root (contains memories/ directory)
 * @param {string} [opts.projectId] - project ID for project-specific scope
 * @param {boolean} [opts.force=false] - overwrite existing skill files
 * @returns {{ skills: number, names: string[], skipped: number }}
 */
export async function generateSkills(opts) {
  const { repoPath, projectId, force = false } = opts;
  const memoriesDir = path.join(repoPath, 'memories');
  const now = new Date().toISOString();

  // Read all memory sources (same pattern as summarizeMemories)
  const [userMem, globalMem, projectMem, workingProjectMem] = await Promise.all([
    readJSONL(path.join(memoriesDir, 'user.jsonl')),
    readJSONL(path.join(memoriesDir, 'working', 'global.jsonl')),
    projectId
      ? readJSONL(path.join(memoriesDir, 'projects', `${projectId}.jsonl`))
      : Promise.resolve([]),
    projectId
      ? readJSONL(path.join(memoriesDir, 'working', 'projects', `${projectId}.jsonl`))
      : Promise.resolve([])
  ]);

  // Merge all sources and filter for skill candidates
  const allMemories = [...userMem, ...globalMem, ...projectMem, ...workingProjectMem];
  const candidates = allMemories.filter(isSkillCandidate);

  // Group by primary tag
  const groups = groupByPrimaryTag(candidates);

  const skillsDir = path.join(repoPath, 'skills');
  let skills = 0;
  const names = [];
  let skipped = 0;

  for (const [clusterName, cluster] of groups) {
    const workflowCount = cluster.filter(m => m.kind === 'workflow').length;

    if (workflowCount < MIN_WORKFLOW_COUNT) {
      skipped++;
      continue;
    }

    const slug = slugify(clusterName);
    const skillDir = path.join(skillsDir, slug);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (!force && fs.existsSync(skillFile)) {
      skipped++;
      continue;
    }

    const md = renderSkillMarkdown(clusterName, cluster, now);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, md, 'utf8');

    skills++;
    names.push(slug);
  }

  return { skills, names, skipped };
}
