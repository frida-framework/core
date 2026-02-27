#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectProfile } from './lib/detect-profile.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const profileMap = {
  'kilo-vscode': 'test:smoke',
  'kilo-cloud': 'test:fast',
  'codex-cloud': 'test:fast',
  'codex-console-wsl': 'test:full',
  'github-actions': 'test:full',
};

const detection = await detectProfile();
const command = profileMap[detection.profile] || 'test:fast';

const steps = [
  { label: 'docs:fullcheck', command: process.execPath, args: [path.join(scriptDir, 'run-docs-fullcheck.mjs')] },
  { label: command, command: 'npm', args: ['run', command] },
];

let exitCode = 0;
for (const step of steps) {
  console.log(`[test:ultimate] ${step.label}`);
   
  exitCode = await run(step.command, step.args, step.label);
  if (exitCode !== 0) break;
}

process.exit(exitCode);

function run(cmd, args, label) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(`[test:ultimate] Ошибка ${label}: ${error.message}`);
      resolve(1);
    });
  });
}
