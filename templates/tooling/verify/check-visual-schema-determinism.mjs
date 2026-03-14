#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import {
  composeEffectiveVisualContract,
  extractVisualSchemaOverlay,
  FIXED_TIMESTAMP,
  loadEffectiveVisualContractDocument,
  normalizeOverlayForComparison,
  resolveVisualOverlayPath,
} from '../lib/visual-schema-extractor.mjs';

const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function isCoreSelfRepo() {
  const packageJsonPath = path.join(ROOT_DIR, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return pkg?.name === '@sistemado/frida' && fs.existsSync(path.join(ROOT_DIR, 'contract', 'contract.index.yaml'));
  } catch {
    return false;
  }
}

function loadContractFromIndex(indexPath) {
  const index = yaml.parse(fs.readFileSync(indexPath, 'utf8'));
  const layers = Array.isArray(index?.layers)
    ? index.layers
    : Array.isArray(index?.contract_index?.layers)
      ? index.contract_index.layers
      : null;
  if (!layers) {
    fail(`Contract index at ${path.relative(ROOT_DIR, indexPath)} is missing layers.`);
  }

  const indexDir = path.dirname(indexPath);
  const repoRoot = path.resolve(indexDir, '..');
  const contract = {};
  for (const layer of layers) {
    const relativePath = layer?.path;
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      continue;
    }
    const layerPathFromIndexDir = path.resolve(indexDir, relativePath);
    const layerPathFromRepoRoot = path.resolve(repoRoot, relativePath);
    const layerPath = fs.existsSync(layerPathFromIndexDir) ? layerPathFromIndexDir : layerPathFromRepoRoot;
    if (!fs.existsSync(layerPath)) {
      fail(`Contract layer not found: ${path.relative(ROOT_DIR, layerPath)}`);
    }
    Object.assign(contract, yaml.parse(fs.readFileSync(layerPath, 'utf8')));
  }
  return contract;
}

function loadLiveContract() {
  const explicitContractPath = isCoreSelfRepo() ? 'contract/contract.index.yaml' : undefined;
  const loaded = loadEffectiveVisualContractDocument(ROOT_DIR, explicitContractPath);
  const contract = loaded?.parsed;
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }

  return {
    contract,
    raw: loaded.raw,
    contractPath: loaded.contractPath,
    sourcePath: path.relative(ROOT_DIR, loaded.contractPath).replace(/\\/g, '/'),
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

  if (JSON.stringify(first) !== JSON.stringify(second)) {
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
    fail('Seeded host-root visual smoke overlay must be non-empty.');
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

function runSeededCoreSmoke(coreContract) {
  const templateContractPath = path.join(ROOT_DIR, 'templates', 'template_app_basic', 'app-contract', 'contract.index.yaml');
  if (!fs.existsSync(templateContractPath)) {
    fail(`Template app contract index not found: ${path.relative(ROOT_DIR, templateContractPath)}`);
  }

  const templateContract = loadContractFromIndex(templateContractPath);
  const seededContract = composeEffectiveVisualContract(templateContract, coreContract);
  const seededRaw = yaml.stringify(seededContract);
  const seededOverlay = compareDeterminism(
    seededContract,
    seededRaw,
    'templates/template_app_basic/app-contract/contract.index.yaml',
    templateContractPath,
  );
  assertNonEmptyLiveOverlay(seededOverlay);
  assertOverlayVocabulary(seededOverlay);

  return seededOverlay;
}

function main() {
  console.log('🔍 Checking visual overlay determinism...');
  const { contract, raw, sourcePath, contractPath } = loadLiveContract();
  const expectedOverlay = compareDeterminism(contract, raw, sourcePath, contractPath);
  assertOverlayVocabulary(expectedOverlay);
  compareGeneratedArtifact(contract, expectedOverlay);

  const stats = [
    `units=${expectedOverlay.projection_units.length}`,
    `boundaries=${expectedOverlay.component_boundaries.length}`,
  ];

  if (isCoreSelfRepo()) {
    const seededOverlay = runSeededCoreSmoke(contract);
    stats.push(`seeded_units=${seededOverlay.projection_units.length}`);
    stats.push(`seeded_boundaries=${seededOverlay.component_boundaries.length}`);
  }

  console.log(`✅ Visual overlay determinism OK (${stats.join(', ')})`);
}

try {
  main();
} catch (error) {
  fail(`check-visual-schema-determinism failed: ${error instanceof Error ? error.message : String(error)}`);
}
