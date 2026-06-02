import fs from 'node:fs';
import path from 'node:path';
import { readJSONL } from './repo-store.js';
import { MEMORY_KINDS, normalizeContent } from './schema.js';

const MIN_CONFIDENCE = 0.6;
const MIN_IMPORTANCE = 0.3;

const KIND_HEADING = {
  preference: 'Preferences',
  identity: 'Identity',
  project_fact: 'Project Facts',
  decision: 'Decisions',
  workflow: 'Workflows',
  correction: 'Corrections',
  warning: 'Warnings',
  episode: 'Episodes'
};

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
  if ((memory.confidence ?? 0) < MIN_CONFIDENCE) return false;
  if ((memory.importance ?? 0) < MIN_IMPORTANCE) return false;
  return true;
}

function groupByKind(memories) {
  const groups = new Map();
  for (const m of memories) {
    if (!groups.has(m.kind)) groups.set(m.kind, []);
    groups.get(m.kind).push(m);
  }
  for (const [, arr] of groups) {
    arr.sort((a, b) => computeScore(b) - computeScore(a));
  }
  return groups;
}

function formatDate(iso) {
  if (!iso) return 'unknown';
  return iso.slice(0, 10);
}

function renderMemoryLine(memory) {
  const content = normalizeContent(memory.content);
  const importance = (memory.importance ?? 0.5).toFixed(1);
  const updated = formatDate(memory.updatedAt);
  return `- ${content} (importance: ${importance}, updated: ${updated})`;
}

function renderSection(heading, memories) {
  if (!memories || memories.length === 0) return '';
  const lines = [`## ${heading}`];
  for (const m of memories) {
    lines.push(renderMemoryLine(m));
  }
  lines.push('');
  return lines.join('\n');
}

function generateProfileMarkdown(memories, now) {
  const groups = groupByKind(memories);
  const lines = [
    '# User Profile',
    `Generated: ${now} | Sources: ${memories.length} memories`,
    ''
  ];
  for (const kind of MEMORY_KINDS) {
    const heading = KIND_HEADING[kind];
    const items = groups.get(kind);
    if (items && items.length > 0) {
      lines.push(`## ${heading}`);
      for (const m of items) {
        const content = normalizeContent(m.content);
        const confidence = (m.confidence ?? 0.5).toFixed(2);
        lines.push(`- ${content} (confidence: ${confidence})`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function generateSummaryMarkdown(memories, title, now) {
  const groups = groupByKind(memories);
  const lines = [
    `# ${title}`,
    `Generated: ${now} | Sources: ${memories.length} memories`,
    ''
  ];
  for (const kind of MEMORY_KINDS) {
    const heading = KIND_HEADING[kind];
    const items = groups.get(kind);
    if (items && items.length > 0) {
      lines.push(`## ${heading}`);
      for (const m of items) {
        lines.push(renderMemoryLine(m));
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function safeReadJSONL(filePath) {
  try {
    // readJSONL is async but we need sync for the current pattern.
    // We'll handle this in the main function.
    return readJSONL(filePath);
  } catch {
    return [];
  }
}

/**
 * Generate summary markdown files from memories
 * @param {Object} opts
 * @param {string} opts.repoPath - path to memory repo root (contains memories/ directory)
 * @param {string} [opts.projectId] - project ID for project-specific summary
 * @param {boolean} [opts.force=false] - overwrite existing summary files
 * @returns {{ profile: boolean, summary: boolean, project: boolean, memoryCount: number }}
 */
export async function summarizeMemories(opts) {
  const { repoPath, projectId, force = false } = opts;
  const memoriesDir = path.join(repoPath, 'memories');
  const now = new Date().toISOString();

  // Read all memory sources
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

  // Filter valid memories
  const validUser = userMem.filter(isValid);
  const validGlobal = globalMem.filter(isValid);
  const validProject = [...projectMem, ...workingProjectMem].filter(isValid);

  const totalMemoryCount = validUser.length + validGlobal.length + validProject.length;

  // Profile: user scope, preference/identity kinds
  const profileMemories = validUser.filter(
    m => m.kind === 'preference' || m.kind === 'identity'
  );

  // Summary: global scope, all kinds
  const summaryMemories = validGlobal;

  // Project summary: project scope
  const projectMemories = validProject;

  const result = { profile: false, summary: false, project: false, memoryCount: totalMemoryCount };

  // Generate profile.md
  const profilePath = path.join(repoPath, 'profile.md');
  if (force || !fs.existsSync(profilePath)) {
    const md = generateProfileMarkdown(profileMemories, now);
    fs.writeFileSync(profilePath, md, 'utf8');
    result.profile = true;
  }

  // Generate summary.md
  const summaryPath = path.join(repoPath, 'summary.md');
  if (force || !fs.existsSync(summaryPath)) {
    const md = generateSummaryMarkdown(summaryMemories, 'Memory Summary', now);
    fs.writeFileSync(summaryPath, md, 'utf8');
    result.summary = true;
  }

  // Generate project summary
  if (projectId) {
    const projectDir = path.join(repoPath, 'projects', projectId);
    const projectSummaryPath = path.join(projectDir, 'summary.md');
    if (force || !fs.existsSync(projectSummaryPath)) {
      fs.mkdirSync(projectDir, { recursive: true });
      const md = generateSummaryMarkdown(
        projectMemories,
        `Project Summary: ${projectId}`,
        now
      );
      fs.writeFileSync(projectSummaryPath, md, 'utf8');
      result.project = true;
    }
  }

  return result;
}
