#!/usr/bin/env node
import path from 'node:path';
import {
  extractVisualSchemaOverlay,
  loadEffectiveVisualContractDocument,
} from '../lib/visual-schema-extractor.mjs';
import { PUBLIC_CONTRACT_INDEX_REL } from '../lib/source-contract-paths.mjs';

const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadContract() {
  const loaded = loadEffectiveVisualContractDocument(ROOT_DIR);
  const contract = loaded?.parsed;
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  return {
    raw: loaded.raw,
    contract,
    contractPath: loaded.contractPath,
    sourcePath: path.relative(ROOT_DIR, loaded.contractPath).replace(/\\/g, '/'),
  };
}

function main() {
  console.log('🔍 Checking visual fail-hard no-skip behavior...');
  const { raw, contract, contractPath, sourcePath } = loadContract();

  extractVisualSchemaOverlay(contract, raw, {
    generatedAt: '1970-01-01T00:00:00.000Z',
    sourcePath,
    contractPath,
  });

  let failedHard = false;
  try {
    extractVisualSchemaOverlay({}, '{}', {
      generatedAt: '1970-01-01T00:00:00.000Z',
      sourcePath: PUBLIC_CONTRACT_INDEX_REL,
      contractPath: path.join(ROOT_DIR, PUBLIC_CONTRACT_INDEX_REL),
    });
  } catch {
    failedHard = true;
  }

  if (!failedHard) {
    fail('Visual overlay compiler did not fail-hard on missing FRIDA_VISUAL projection authority.');
  }

  console.log('✅ Visual no-skip fail-hard behavior OK');
}

try {
  main();
} catch (error) {
  fail(`check-visual-no-skip failed: ${error instanceof Error ? error.message : String(error)}`);
}
