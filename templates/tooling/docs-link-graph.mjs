#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const docsRoot = path.join(repoRoot, 'docs');
const outDir = path.join(repoRoot, 'artifacts', 'docs');
const outFile = path.join(outDir, 'link-graph.json');

const files = await glob('**/*.md', { cwd: docsRoot, absolute: true });
const nodes = [];
const edges = [];

for (const file of files) {
  const rel = path.relative(repoRoot, file);
  const content = await readFile(file, 'utf8');
  const links = extractLinks(content, path.dirname(file));
  nodes.push({ id: rel, links });
  for (const link of links) {
    edges.push({ from: rel, to: link });
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(outFile, JSON.stringify({ nodes, edges }, null, 2));
console.log(`[docs-link-graph] Saved ${edges.length} edges for ${nodes.length} nodes to ${path.relative(repoRoot, outFile)}`);

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
