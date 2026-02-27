#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkgPath = path.join(repoRoot, 'package.json');
const catalogPath = path.join(repoRoot, 'docs', 'runbooks', 'ops', 'COMMANDS.md');

const publicCommands = [
  'docs:graph',
  'docs:navcheck',
  'docs:commands:check',
  'docs:fullcheck',
  'test:whoami',
  'test:smoke',
  'test:fast',
  'test:full',
  'test:ultimate',
  'typecheck:web',
  'typecheck:edge',
  'lint',
  'check:docs',
  'test:regression',
  'e2e:share',
  'e2e:stops',
  'e2e:regression',
  'e2e:llm-fallback',
];

const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
const scripts = pkg.scripts || {};

const catalog = await readFile(catalogPath, 'utf8');
const documented = Array.from(new Set([...catalog.matchAll(/`npm run ([^`]+)`/g)].map((m) => m[1])));

const missingInPkg = documented.filter((cmd) => !scripts[cmd]);
const missingInDoc = publicCommands.filter((cmd) => !documented.includes(cmd));

if (missingInPkg.length || missingInDoc.length) {
  console.error('[check-commands-catalog] Несовпадения в каталоге команд.');
  if (missingInPkg.length) console.error(` - Нет в package.json: ${missingInPkg.join(', ')}`);
  if (missingInDoc.length) console.error(` - Нет в docs/runbooks/ops/COMMANDS.md: ${missingInDoc.join(', ')}`);
  process.exit(1);
}

console.log('[check-commands-catalog] Каталог команд соответствует package.json');
process.exit(0);
