#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const steps = [
  { label: 'docs:graph', command: process.execPath, args: [path.join(scriptDir, 'docs-link-graph.mjs')] },
  { label: 'docs:navcheck', command: process.execPath, args: [path.join(scriptDir, 'docs-nav-check.mjs')] },
  { label: 'docs:commands:check', command: process.execPath, args: [path.join(scriptDir, 'check-commands-catalog.mjs')] },
  { label: 'test-matrix', command: process.execPath, args: [path.join(scriptDir, 'validate-test-matrix.mjs')] },
  { label: 'profile-detect', command: process.execPath, args: [path.join(scriptDir, 'detect-test-profile.mjs')] },
];

let exitCode = 0;
for (const step of steps) {
  console.log(`[docs:fullcheck] Запуск ${step.label}`);
   
  const result = await run(step.command, step.args, step.label);
  if (result !== 0) {
    exitCode = result;
    break;
  }
}

process.exit(exitCode);

function run(cmd, args, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(`[docs:fullcheck] Ошибка ${label}: ${error.message}`);
      resolve(1);
    });
  });
}
