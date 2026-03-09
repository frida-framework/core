#!/usr/bin/env node
/**
 * Thin wrapper around the canonical frida-core contract-set checker.
 *
 * This avoids drift between the package CLI gate and the generated repo-local
 * verifier script that target repos receive under scripts/verify/.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const LOCAL_CLI = path.join(ROOT_DIR, 'dist', 'cli.js');

function fail(message, code = 1) {
  console.error(`AGENTS contract-set check error: ${message}`);
  process.exit(code);
}

function runViaLocalCli(args) {
  return spawnSync(process.execPath, [LOCAL_CLI, 'check', 'contract-set', ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
}

function runViaFridaCore(args) {
  const executable = process.platform === 'win32' ? 'frida-core.cmd' : 'frida-core';
  return spawnSync(executable, ['check', 'contract-set', ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
}

const forwardedArgs = process.argv.slice(2);
const result = existsSync(LOCAL_CLI)
  ? runViaLocalCli(forwardedArgs)
  : runViaFridaCore(forwardedArgs);

if (result.error) {
  fail(result.error.message, 2);
}

process.exit(result.status ?? 1);
