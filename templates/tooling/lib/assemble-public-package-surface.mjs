import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import {
  CORE_BOOTSTRAP_MANIFEST_REL,
  CORE_CONTRACT_INDEX_REL,
  PUBLIC_BOOTSTRAP_MANIFEST_REL,
  PUBLIC_CONTRACT_INDEX_REL,
  PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX,
  PUBLIC_CONTRACT_LAYER_DIR_REL,
  PUBLIC_CONTRACT_LAYER_FILE_SUFFIX,
  PUBLIC_CONTRACT_PROJECTION_KIND,
  PUBLIC_TEMPLATE_INTEGRITY_MANIFEST_REL,
  toPublicContractLayerFileName,
  toPublicContractLayerIndexPath,
} from './source-contract-paths.mjs';

const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const SOURCE_INDEX_PATH = path.join(ROOT_DIR, CORE_CONTRACT_INDEX_REL);
const TARGET_INDEX_PATH = path.join(ROOT_DIR, PUBLIC_CONTRACT_INDEX_REL);
const SOURCE_CONTRACT_DIR = path.dirname(SOURCE_INDEX_PATH);
const TARGET_CONTRACT_DIR = path.dirname(TARGET_INDEX_PATH);

const ROOT_CONTRACT_FILES = [
  'bootstrap-package.manifest.yaml',
  'template-integrity.manifest.yaml',
];

const SOURCE_ONLY_PREFIXES = [
  'core-templates/management/',
  'core-tasks/',
];

const EXACT_PATH_REWRITES = [
  [CORE_CONTRACT_INDEX_REL, PUBLIC_CONTRACT_INDEX_REL],
  ['core-contract/template-integrity.manifest.yaml', PUBLIC_TEMPLATE_INTEGRITY_MANIFEST_REL],
  [CORE_BOOTSTRAP_MANIFEST_REL, PUBLIC_BOOTSTRAP_MANIFEST_REL],
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringValue(value) {
  let rewritten = value.replace(/\\/g, '/');
  for (const [from, to] of EXACT_PATH_REWRITES) {
    rewritten = rewritten.replaceAll(from, to);
  }
  rewritten = rewritten.replace(
    /core-contract\/layers\/([A-Za-z0-9._-]+\.ya?ml)/g,
    (_, layerFileName) => `${PUBLIC_CONTRACT_LAYER_DIR_REL}/${toPublicContractLayerFileName(layerFileName)}`,
  );
  return rewritten.replaceAll('core-contract/', 'contract/');
}

function getBlockVisibility(key, block) {
  if (block && typeof block === 'object' && '_visibility' in block) {
    const visibility = block._visibility;
    if (visibility === 'public' || visibility === 'private') {
      return visibility;
    }
  }
  if (key.startsWith('FRIDA_INTERFACE_')) {
    return 'public';
  }
  return 'public';
}

function collectPrivateBlocks() {
  const layersDir = path.join(SOURCE_CONTRACT_DIR, 'layers');
  const privateBlocks = new Set();

  for (const entry of fs.readdirSync(layersDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
    const parsed = YAML.parse(fs.readFileSync(path.join(layersDir, entry.name), 'utf8'));
    if (!isPlainObject(parsed)) continue;
    for (const [key, value] of Object.entries(parsed)) {
      if (isPlainObject(value) && value._visibility === 'private') {
        privateBlocks.add(key);
      }
    }
  }

  return privateBlocks;
}

function isPrivateBlockRef(value, privateBlocks) {
  for (const block of privateBlocks) {
    if (value === block || value.startsWith(`${block}.`)) {
      return true;
    }
  }
  return false;
}

function sanitizeNode(node, privateBlocks, key = null) {
  if (typeof node === 'string') {
    if (isPrivateBlockRef(node, privateBlocks)) {
      return undefined;
    }
    if (key === 'source_playbook_ref') {
      return undefined;
    }
    if (SOURCE_ONLY_PREFIXES.some((prefix) => node.startsWith(prefix))) {
      return undefined;
    }
    return normalizeStringValue(node);
  }

  if (Array.isArray(node)) {
    return node
      .map((item) => sanitizeNode(item, privateBlocks, key))
      .filter((item) => item !== undefined);
  }

  if (!isPlainObject(node)) {
    return node;
  }

  if (typeof node.interface_ref === 'string' && privateBlocks.has(node.interface_ref)) {
    return undefined;
  }
  if (typeof node.block === 'string' && privateBlocks.has(node.block)) {
    return undefined;
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(node)) {
    if (childKey === '_visibility' || privateBlocks.has(childKey)) {
      continue;
    }
    const sanitizedValue = sanitizeNode(childValue, privateBlocks, childKey);
    if (sanitizedValue === undefined) {
      continue;
    }
    if (isPlainObject(sanitizedValue) && Object.keys(sanitizedValue).length === 0) {
      continue;
    }
    result[childKey] = sanitizedValue;
  }
  return result;
}

function loadYaml(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeYaml(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, YAML.stringify(value, { lineWidth: 120 }), 'utf8');
}

function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function refreshBootstrapManifestHashes(manifestPath) {
  const manifest = loadYaml(manifestPath);
  if (!isPlainObject(manifest) || !Array.isArray(manifest.entries)) {
    return 0;
  }

  let refreshed = 0;
  for (const entry of manifest.entries) {
    if (!isPlainObject(entry) || typeof entry.source !== 'string' || !entry.source.trim()) {
      continue;
    }

    const sourceAbsPath = path.resolve(ROOT_DIR, entry.source);
    if (!fs.existsSync(sourceAbsPath) || !fs.statSync(sourceAbsPath).isFile()) {
      continue;
    }

    const nextHash = sha256File(sourceAbsPath);
    if (entry.sha256 !== nextHash) {
      entry.sha256 = nextHash;
      refreshed += 1;
    }
  }

  writeYaml(manifestPath, manifest);
  return refreshed;
}

function buildPublicContract() {
  if (!fs.existsSync(SOURCE_INDEX_PATH)) {
    throw new Error(`Source contract index not found: ${SOURCE_INDEX_PATH}`);
  }

  const sourceIndex = loadYaml(SOURCE_INDEX_PATH);
  const layers = Array.isArray(sourceIndex?.layers)
    ? sourceIndex.layers
    : Array.isArray(sourceIndex?.contract_index?.layers)
      ? sourceIndex.contract_index.layers
      : null;

  if (!layers) {
    throw new Error('Source contract index is missing layers.');
  }

  const privateBlocks = collectPrivateBlocks();
  fs.rmSync(TARGET_CONTRACT_DIR, { recursive: true, force: true });
  ensureDir(path.join(TARGET_CONTRACT_DIR, PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX));

  const publicLayers = [];
  for (const layer of layers) {
    const sourceLayerRel = String(layer?.path || '').replace(/\\/g, '/');
    if (!sourceLayerRel) continue;

    const sourceLayerAbs = path.resolve(ROOT_DIR, sourceLayerRel);
    if (!fs.existsSync(sourceLayerAbs)) {
      throw new Error(`Source contract layer not found: ${sourceLayerRel}`);
    }

    const sourceLayerDoc = loadYaml(sourceLayerAbs);
    if (!isPlainObject(sourceLayerDoc)) {
      continue;
    }

    const blockList = Array.isArray(layer?.blocks) ? layer.blocks.filter((item) => typeof item === 'string') : [];
    const publicBlockIds = blockList.filter((blockId) => getBlockVisibility(blockId, sourceLayerDoc[blockId]) === 'public');

    if (publicBlockIds.length === 0) {
      continue;
    }

    const filteredLayerDoc = {};
    for (const blockId of publicBlockIds) {
      const sanitizedBlock = sanitizeNode(sourceLayerDoc[blockId], privateBlocks, blockId);
      if (sanitizedBlock !== undefined) {
        filteredLayerDoc[blockId] = sanitizedBlock;
      }
    }

    if (Object.keys(filteredLayerDoc).length === 0) {
      continue;
    }

    const sourceLayerFileName = path.basename(sourceLayerRel);
    const publicLayerFileName = toPublicContractLayerFileName(sourceLayerFileName);
    writeYaml(path.join(TARGET_CONTRACT_DIR, PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX, publicLayerFileName), filteredLayerDoc);
    publicLayers.push({
      ...layer,
      path: toPublicContractLayerIndexPath(sourceLayerFileName),
      visibility: 'public',
      blocks: publicBlockIds,
    });
  }

  writeYaml(TARGET_INDEX_PATH, {
    ...sourceIndex,
    projection: {
      kind: PUBLIC_CONTRACT_PROJECTION_KIND,
      layer_dir: PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX,
      layer_file_suffix: PUBLIC_CONTRACT_LAYER_FILE_SUFFIX,
      naming_rule: 'Projected public layers MUST live under public-layers/ and use a .public.yaml suffix.',
    },
    layers: publicLayers,
  });

  for (const fileName of ROOT_CONTRACT_FILES) {
    const sourcePath = path.join(SOURCE_CONTRACT_DIR, fileName);
    const targetPath = path.join(TARGET_CONTRACT_DIR, fileName);
    fs.copyFileSync(sourcePath, targetPath);
    if (fileName === 'bootstrap-package.manifest.yaml') {
      const refreshed = refreshBootstrapManifestHashes(targetPath);
      if (refreshed > 0) {
        console.log(`↻ Refreshed ${refreshed} bootstrap-package hashes for the public package surface`);
      }
    }
  }
}

try {
  buildPublicContract();
  console.log('✅ Public package contract assembled from core-contract');
} catch (error) {
  console.error(`❌ Failed to assemble public package contract: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
