#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { glob } from 'glob';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = path.join(repoRoot, 'supabase', 'functions');
const denoConfig = path.join('supabase', 'functions', 'deno.json');

const entries = await glob('**/index.ts', {
  cwd: functionsRoot,
  absolute: true,
});

if (entries.length === 0) {
  console.log('Не найдено файлов supabase/functions/**/index.ts — пропускаем deno check.');
  process.exit(0);
}

const denoReady = await ensureDeno();
if (!denoReady) {
  const exitCode = process.env.CI === 'true' ? 1 : 0;
  process.exit(exitCode);
}

let exitCode = 0;

for (const entry of entries) {
  const relative = path.relative(repoRoot, entry);
  console.log(`[typecheck-edge] deno check ${relative}`);
   
  const result = await runCommand('deno', ['check', '--config', denoConfig, relative], {
    cwd: repoRoot,
  });
  if (result !== 0) {
    exitCode = result;
  }
}

process.exit(exitCode);

async function ensureDeno() {
  const result = await runCommand('deno', ['--version'], { cwd: repoRoot, quiet: true });
  if (result !== 0) {
    const message = '[typecheck-edge] deno не найден. Установите Deno: https://deno.land/#installation';
    if (process.env.CI === 'true') {
      console.error(`${message} (CI режим требует deno)`);
    } else {
      console.warn(`${message} (локально пропускаем deno check)`);
    }
    return false;
  }
  return true;
}

function runCommand(command, args, { cwd, quiet = false }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: quiet ? 'ignore' : 'inherit',
    });

    child.on('close', (code) => {
      resolve(code ?? 1);
    });

    child.on('error', (error) => {
      console.error(`[typecheck-edge] Ошибка запуска ${command}: ${error.message}`);
      resolve(1);
    });
  });
}
