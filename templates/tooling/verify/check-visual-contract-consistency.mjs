#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { loadModularContract } from '../lib/load-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadContract() {
  const contract = loadModularContract(ROOT_DIR);
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  return { raw: '', contract };
}

function isObjectLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertPathRef(contract, refPath, issues) {
  const parts = refPath.split('.');
  let cursor = contract;
  for (const part of parts) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      issues.push(`Missing required path: ${refPath}`);
      return;
    }
    cursor = cursor[part];
  }
  if (typeof cursor !== 'string' || !cursor.trim()) {
    issues.push(`Path must be a non-empty string: ${refPath}`);
  }
}

function assertVisualContracts(contract, issues) {
  if (!isObjectLike(contract.VISUAL_SCHEMA)) {
    issues.push('VISUAL_SCHEMA block is missing or invalid.');
    return;
  }

  if (typeof contract.VISUAL_SCHEMA.version !== 'string' || !contract.VISUAL_SCHEMA.version.trim()) {
    issues.push('VISUAL_SCHEMA.version must be a non-empty string.');
  }
}

function assertVisualPaths(contract, issues) {
  assertPathRef(contract, 'FRIDA_CONFIG.visual.overlay_outputFileRef', issues);
  assertPathRef(contract, 'PATHS.frida.visualOverlayFile', issues);
}

function main() {
  console.log('🔍 Checking visual contract consistency...');
  const { contract } = loadContract();
  const issues = [];

  assertVisualContracts(contract, issues);
  assertVisualPaths(contract, issues);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    fail(`Visual contract consistency FAILED with ${issues.length} issue(s).`);
  }

  console.log('✅ Visual contract consistency OK');
}

try {
  main();
} catch (error) {
  fail(`check-visual-contract-consistency failed: ${error instanceof Error ? error.message : String(error)}`);
}
