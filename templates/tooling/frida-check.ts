#!/usr/bin/env tsx
import {
  runFridaCheckCli,
  loadZones,
  resolveZone,
  getExpectedAgentsMd,
  validateZoneAgentsMd,
  type Zone,
  type ZoneCandidate,
  type DecisionStep,
  type ValidationResult,
} from './frida-core-bridge.ts';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

export {
  loadZones,
  resolveZone,
  getExpectedAgentsMd,
  validateZoneAgentsMd,
  type Zone,
  type ZoneCandidate,
  type DecisionStep,
  type ValidationResult,
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONTRACT_SET_VERIFIER = path.join(REPO_ROOT, 'scripts', 'verify', 'check-agents-contract-set.mjs');

function normalizeCliArgs(argv: string[]): string[] {
  if (argv.length === 0) return argv;

  const args = [...argv];
  const first = args[0] || '';
  if (first.endsWith('frida-check.ts') || first.endsWith('frida-check.js')) {
    args.shift();
  }

  const separatorIndex = args.indexOf('--');
  if (separatorIndex >= 0) {
    return args.slice(separatorIndex + 1);
  }

  return args;
}

function runContractSetCheck(): number {
  const result = spawnSync(process.execPath, [CONTRACT_SET_VERIFIER], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`frida:check failed to run contract-set verifier: ${result.error.message}`);
    return 2;
  }

  return typeof result.status === 'number' ? result.status : 2;
}

function isExecutedDirectly(moduleMetaUrl: string): boolean {
  const executedPath = process.argv[1];
  if (!executedPath) {
    return false;
  }
  return path.resolve(executedPath) === path.resolve(fileURLToPath(moduleMetaUrl));
}

if (isExecutedDirectly(import.meta.url)) {
  const args = normalizeCliArgs(process.argv.slice(2));
  if (args.length === 0 || args[0] === 'contract-set') {
    process.exit(runContractSetCheck());
  }

  runFridaCheckCli(args)
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(2);
    });
}

