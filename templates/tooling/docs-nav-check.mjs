#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const docsRoot = path.join(repoRoot, 'docs');
const graphPath = path.join(repoRoot, 'artifacts', 'docs', 'link-graph.json');
const reportDir = path.join(repoRoot, 'artifacts', 'docs');
const reportPath = path.join(reportDir, 'nav-report.md');

const contract = 'docs/guides/testing/README.md';
const keyNodes = [
  contract,
  'docs/guides/testing-guide.md',
  'docs/guides/testing/post-deploy-checklist.md',
  'docs/runbooks/ops/TESTING_SYSTEM.md',
  'docs/runbooks/ops/COMMANDS.md',
];
const scopeRoots = ['docs/guides/testing', 'docs/runbooks/ops'];

const graph = await loadGraph();
const problems = [];

await checkBrokenLinks(graph, problems);
await checkReachability(graph, problems);
await checkArchiveTraps(graph, problems);

await mkdir(reportDir, { recursive: true });
const report = renderReport(problems);
await writeFile(reportPath, report);

if (problems.length > 0) {
  console.error('[docs-nav-check] Навигационные проблемы найдены. См. artifacts/docs/nav-report.md');
  process.exit(1);
}

console.log('[docs-nav-check] Навигация проверена, проблем не обнаружено.');
process.exit(0);

async function loadGraph() {
  try {
    const raw = await readFile(graphPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    // fallback: построить на лету, как docs-link-graph
    const files = await glob('**/*.md', { cwd: docsRoot, absolute: true });
    const nodes = [];
    const edges = [];
    for (const file of files) {
      const rel = path.relative(repoRoot, file);
      const content = await readFile(file, 'utf8');
      const links = extractLinks(content, path.dirname(file));
      nodes.push({ id: rel, links });
      for (const link of links) edges.push({ from: rel, to: link });
    }
    return { nodes, edges };
  }
}

async function checkBrokenLinks(graphData, collector) {
  for (const edge of graphData.edges) {
    if (!isInScope(edge.from)) continue;
    const target = edge.to;
    const targetPath = path.join(repoRoot, target);
    if (!(await exists(targetPath))) {
      collector.push({ type: 'broken-link', message: `Нет файла для ссылки ${edge.from} -> ${target}` });
    }
  }
}

async function checkReachability(graphData, collector) {
  const adjacency = new Map();
  for (const node of graphData.nodes) {
    adjacency.set(node.id, node.links || []);
  }

  const distances = bfs(adjacency, contract);

  for (const key of keyNodes) {
    if (!distances.has(key)) {
      collector.push({ type: 'unreachable', message: `${key} недостижим из ${contract}` });
    } else if (distances.get(key) > 2) {
      collector.push({ type: 'click-budget', message: `${key} достигается за ${distances.get(key)} кликов (>2)` });
    }
  }
}

async function checkArchiveTraps(graphData, collector) {
  for (const edge of graphData.edges) {
    if (!isInScope(edge.from)) continue;
    if (!edge.to.includes('docs/archive')) continue;
    const sourceFile = path.join(repoRoot, edge.from);
    const content = await readFile(sourceFile, 'utf8');
    if (!content.toLowerCase().includes('deprecated')) {
      collector.push({ type: 'archive-trap', message: `Ссылка в архив без пометки DEPRECATED: ${edge.from} -> ${edge.to}` });
    }
  }
}

function isInScope(file) {
  return scopeRoots.some((root) => file.startsWith(root));
}

function renderReport(issues) {
  if (issues.length === 0) {
    return '# Docs Navigation Report\n\n- Проблем не найдено.\n';
  }
  const lines = ['# Docs Navigation Report', '', 'Найдены проблемы:', ''];
  for (const issue of issues) {
    lines.push(`- [${issue.type}] ${issue.message}`);
  }
  return lines.join('\n');
}

function extractLinks(markdown, dir) {
  const results = [];
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    const raw = match[1];
    if (raw.startsWith('http') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
    if (raw.startsWith('#')) continue;
    const cleaned = raw.split('#')[0];
    if (!cleaned.trim()) continue;
    const absolute = path.resolve(dir, cleaned);
    const relative = path.relative(repoRoot, absolute);
    results.push(relative);
  }
  return Array.from(new Set(results));
}

function bfs(adjacency, start) {
  const queue = [start];
  const dist = new Map();
  dist.set(start, 0);
  while (queue.length) {
    const node = queue.shift();
    const nexts = adjacency.get(node) || [];
    for (const next of nexts) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(node) + 1);
      queue.push(next);
    }
  }
  return dist;
}

async function exists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    return false;
  }
}
