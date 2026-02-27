#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const vitestBin = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const typecheckEdgeScript = fileURLToPath(new URL('./typecheck-edge.mjs', import.meta.url));

const levels = {
  smoke: [
    {
      label: 'Vitest smoke (L2)',
      command: process.execPath,
      args: [vitestBin, 'run', 'tests/smoke'],
      attachExtra: true,
    },
  ],
  fast: [
    {
      label: 'Typecheck web (L1)',
      command: process.execPath,
      args: [tscBin, '--noEmit', '-p', path.join(scriptDir, '..', 'tsconfig.app.json')],
    },
    {
      label: 'Typecheck edge (L1)',
      command: process.execPath,
      args: [typecheckEdgeScript],
    },
    {
      label: 'Vitest unit (L2)',
      command: process.execPath,
      args: [vitestBin, 'run', '--passWithNoTests'],
      attachExtra: true,
    },
  ],
  full: [
    {
      label: 'Lint (L0)',
      command: 'npm',
      args: ['run', 'lint'],
    },
    {
      label: 'Docs hygiene (L0)',
      command: 'npm',
      args: ['run', 'check:docs'],
    },
    {
      label: 'Typecheck web (L1)',
      command: process.execPath,
      args: [tscBin, '--noEmit', '-p', path.join(scriptDir, '..', 'tsconfig.app.json')],
    },
    {
      label: 'Typecheck edge (L1)',
      command: process.execPath,
      args: [typecheckEdgeScript],
    },
    {
      label: 'Vitest all (L2)',
      command: process.execPath,
      args: [vitestBin, 'run', '--passWithNoTests'],
      attachExtra: true,
    },
  ],
};

const level = process.argv[2] ?? 'smoke';
const extraArgs = process.argv.slice(3);

if (!levels[level]) {
  console.error(`Неизвестный уровень тестов: ${level}. Доступные: ${Object.keys(levels).join(', ')}`);
  process.exit(1);
}

const steps = levels[level];
let exitCode = 0;

for (const step of steps) {
  const args = step.attachExtra ? [...step.args, ...extraArgs] : step.args;
  const rendered = `${step.command} ${args.join(' ')}`;
  console.log(`\n[run-test-level] ${step.label}: ${rendered}`);
   
  exitCode = await runCommand(step.command, args, step.label);
  if (exitCode !== 0) {
    break;
  }
}

process.exit(exitCode);

function runCommand(command, args, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      const resultCode = code ?? 1;
      if (resultCode !== 0) {
        console.error(`[run-test-level] ${label} завершился с кодом ${resultCode}`);
      }
      resolve(resultCode);
    });

    child.on('error', (error) => {
      console.error(`[run-test-level] ${label} ошибка запуска: ${error.message}`);
      resolve(1);
    });
  });
}
