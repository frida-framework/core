#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { extractVisualSchemaOverlay } from '../lib/visual-schema-extractor.mjs';
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

function main() {
  console.log('🔍 Checking visual fail-hard no-skip behavior...');
  const { raw, contract } = loadContract();

  extractVisualSchemaOverlay(contract, raw, { generatedAt: '1970-01-01T00:00:00.000Z' });

  let failedHard = false;
  try {
    extractVisualSchemaOverlay({}, '{}', { generatedAt: '1970-01-01T00:00:00.000Z' });
  } catch {
    failedHard = true;
  }

  if (!failedHard) {
    fail('Visual extractor did not fail-hard on missing VISUAL_SCHEMA.');
  }

  console.log('✅ Visual no-skip fail-hard behavior OK');
}

try {
  main();
} catch (error) {
  fail(`check-visual-no-skip failed: ${error instanceof Error ? error.message : String(error)}`);
}

