#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import {
  extractVisualSchemaOverlay,
  normalizeOverlayForComparison,
  resolveVisualOverlayPath,
} from '../lib/visual-schema-extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const CONTRACT_FILE = path.join(ROOT_DIR, 'contract', 'contract.index.yaml');
const FIXED_TIMESTAMP = '1970-01-01T00:00:00.000Z';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadContract() {
  if (!fs.existsSync(CONTRACT_FILE)) {
    fail(`Contract artifact not found: ${path.relative(ROOT_DIR, CONTRACT_FILE)}`);
  }
  const raw = fs.readFileSync(CONTRACT_FILE, 'utf8');
  const contract = yaml.parse(raw);
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  return { contract, raw };
}

function toAbsolutePath(relativeOrAbsolute) {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  return path.join(ROOT_DIR, relativeOrAbsolute.replace(/^\.\//, '').replace(/^\/+/, ''));
}

function assertVisualSchemaContract(contract) {
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  if (!contract.VISUAL_SCHEMA || typeof contract.VISUAL_SCHEMA !== 'object') {
    fail('contract VISUAL_SCHEMA is missing or invalid.');
  }
  if (typeof contract.VISUAL_SCHEMA.version !== 'string' || !contract.VISUAL_SCHEMA.version.trim()) {
    fail('contract VISUAL_SCHEMA.version must be a non-empty string.');
  }
}

function compareDeterminism(contract, raw) {
  const first = extractVisualSchemaOverlay(contract, raw, { generatedAt: FIXED_TIMESTAMP });
  const second = extractVisualSchemaOverlay(contract, raw, { generatedAt: FIXED_TIMESTAMP });

  const firstJson = JSON.stringify(first);
  const secondJson = JSON.stringify(second);
  if (firstJson !== secondJson) {
    fail('Visual schema extraction is not deterministic (same input produced different overlays).');
  }
  return first;
}

function compareGeneratedArtifact(contract, expectedOverlay) {
  const overlayRelativePath = resolveVisualOverlayPath(contract);
  const overlayPath = toAbsolutePath(overlayRelativePath);
  if (!fs.existsSync(overlayPath)) {
    console.warn(`⚠️  Visual overlay artifact missing: ${path.relative(ROOT_DIR, overlayPath)} (skip drift check).`);
    return;
  }

  const current = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
  const normalizedCurrent = normalizeOverlayForComparison(current);
  const normalizedExpected = normalizeOverlayForComparison(expectedOverlay);

  if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedExpected)) {
    fail(
      `Visual overlay drift detected in ${path.relative(ROOT_DIR, overlayPath)}. ` +
      'Run `npm run -s frida:visual` to regenerate.'
    );
  }
}

function main() {
  console.log('⚠️  VISUAL_SCHEMA check skipped: Schema removed in favor of Contract Types.');
}

try {
  main();
} catch (error) {
  fail(`check-visual-schema-determinism failed: ${error instanceof Error ? error.message : String(error)}`);
}
