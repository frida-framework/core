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
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const LOCAL_CLI = path.join(ROOT_DIR, 'dist', 'cli.js');

function fail(message, code = 1) {
  console.error(`AGENTS contract-set check error: ${message}`);
  process.exit(code);
}

function parseForwardedArgs(args) {
  const options = { rootDir: ROOT_DIR };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--include-frida-internal') {
      options.includeFridaInternal = true;
      continue;
    }
    if (token === '--contract' && typeof args[index + 1] === 'string') {
      options.contractPath = args[index + 1];
      index += 1;
    }
  }

  return options;
}

async function runViaLocalModule(args) {
  const moduleUrl = pathToFileURL(path.join(ROOT_DIR, 'dist', 'agents-contract-set.js')).href;
  const mod = await import(moduleUrl);
  return mod.runFridaAgentsContractSetCheck(parseForwardedArgs(args));
}

function runViaFridaCore(args) {
  const executable = process.platform === 'win32' ? 'frida-core.cmd' : 'frida-core';
  return spawnSync(executable, ['check', 'contract-set', ...args], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
}

const forwardedArgs = process.argv.slice(2);

if (existsSync(LOCAL_CLI)) {
  process.exit(await runViaLocalModule(forwardedArgs));
}

const result = runViaFridaCore(forwardedArgs);
if (result.error) {
  fail(result.error.message, 2);
}
process.exit(result.status ?? 1);
