#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import {
  extractVisualSchemaOverlay,
  FIXED_TIMESTAMP,
  normalizeOverlayForComparison,
  resolveVisualOverlayPath,
} from '../lib/visual-schema-extractor.mjs';
import { loadModularContract } from '../lib/load-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadContract() {
  const candidates = [
    path.join(ROOT_DIR, '.frida', 'inbox', 'app-contract', 'contract.index.yaml'),
    path.join(ROOT_DIR, 'contract', 'contract.index.yaml'),
  ];
  const contractPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!contractPath) {
    fail(`Contract index not found: ${candidates.map((entry) => path.relative(ROOT_DIR, entry)).join(' or ')}`);
  }
  const contract = loadModularContract(ROOT_DIR);
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  return {
    contract,
    raw: yaml.stringify(contract),
    contractPath,
    sourcePath: path.relative(ROOT_DIR, contractPath).replace(/\\/g, '/'),
  };
}

function toAbsolutePath(relativeOrAbsolute) {
  if (path.isAbsolute(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  return path.join(ROOT_DIR, relativeOrAbsolute.replace(/^\.\//, '').replace(/^\/+/, ''));
}

function compareDeterminism(contract, raw, sourcePath, contractPath) {
  const first = extractVisualSchemaOverlay(contract, raw, {
    generatedAt: FIXED_TIMESTAMP,
    sourcePath,
    contractPath,
  });
  const second = extractVisualSchemaOverlay(contract, raw, {
    generatedAt: FIXED_TIMESTAMP,
    sourcePath,
    contractPath,
  });

  const firstJson = JSON.stringify(first);
  const secondJson = JSON.stringify(second);
  if (firstJson !== secondJson) {
    fail('Visual overlay compilation is not deterministic (same input produced different overlays).');
  }
  return first;
}

function compareGeneratedArtifact(contract, expectedOverlay) {
  const overlayRelativePath = resolveVisualOverlayPath(contract);
  const overlayPath = toAbsolutePath(overlayRelativePath);
  if (!fs.existsSync(overlayPath)) {
    fail(`Visual overlay artifact missing: ${path.relative(ROOT_DIR, overlayPath)}. Run \`npm run -s frida:visual\` first.`);
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

function assertNonEmptyLiveOverlay(overlay) {
  if (overlay.projection_units.length === 0 || overlay.component_boundaries.length === 0) {
    fail('Live visual overlay must be non-empty for the assembled authoritative contract.');
  }
}

function assertOverlayVocabulary(overlay) {
  const legacyKinds = new Set([
    'input_interface',
    'entry_to_input',
    'input_to_domain_block',
    'input_to_exit',
  ]);

  for (const node of [...overlay.topology_nodes, ...overlay.flow_nodes, ...overlay.specification_nodes]) {
    if (legacyKinds.has(node.kind)) {
      fail(`Overlay emitted legacy-derived node kind '${node.kind}'.`);
    }
    if (node.kind.startsWith('section:component_')) {
      fail(`Overlay emitted source-like specification kind '${node.kind}'.`);
    }
  }

  for (const edge of [...overlay.topology_edges, ...overlay.flow_edges, ...overlay.specification_edges]) {
    if (legacyKinds.has(edge.kind)) {
      fail(`Overlay emitted legacy-derived edge kind '${edge.kind}'.`);
    }
  }

  for (const boundary of overlay.component_boundaries) {
    for (const forbiddenKey of ['domain_block_ids', 'shared_ref_targets', 'input_interface_keys']) {
      if (Object.prototype.hasOwnProperty.call(boundary, forbiddenKey)) {
        fail(`Overlay emitted forbidden source-like boundary field '${forbiddenKey}'.`);
      }
    }
  }
}

function main() {
  console.log('🔍 Checking visual overlay determinism...');
  const { contract, raw, sourcePath, contractPath } = loadContract();
  const expectedOverlay = compareDeterminism(contract, raw, sourcePath, contractPath);
  assertNonEmptyLiveOverlay(expectedOverlay);
  assertOverlayVocabulary(expectedOverlay);
  compareGeneratedArtifact(contract, expectedOverlay);
  console.log(
    `✅ Visual overlay determinism OK (units=${expectedOverlay.projection_units.length}, boundaries=${expectedOverlay.component_boundaries.length})`
  );
}

try {
  main();
} catch (error) {
  fail(`check-visual-schema-determinism failed: ${error instanceof Error ? error.message : String(error)}`);
}
