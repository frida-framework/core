import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const SOURCE_CONTRACT_DIR = path.join(ROOT_DIR, 'core-contract');
const TARGET_CONTRACT_DIR = path.join(ROOT_DIR, 'contract');
const SOURCE_INDEX_PATH = path.join(SOURCE_CONTRACT_DIR, 'contract.index.yaml');
const TARGET_INDEX_PATH = path.join(TARGET_CONTRACT_DIR, 'contract.index.yaml');

const ROOT_CONTRACT_FILES = [
  'bootstrap-package.manifest.yaml',
  'template-integrity.manifest.yaml',
];

const SOURCE_ONLY_PREFIXES = [
  'core-templates/management/',
  'core-tasks/',
];

const PATH_REWRITES = [
  ['core-contract/', 'contract/'],
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringValue(value) {
  let rewritten = value;
  for (const [from, to] of PATH_REWRITES) {
    rewritten = rewritten.replaceAll(from, to);
  }
  return rewritten;
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
  ensureDir(path.join(TARGET_CONTRACT_DIR, 'layers'));

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

    const layerFileName = path.basename(sourceLayerRel);
    writeYaml(path.join(TARGET_CONTRACT_DIR, 'layers', layerFileName), filteredLayerDoc);
    publicLayers.push({
      ...layer,
      path: `contract/layers/${layerFileName}`,
      visibility: 'public',
      blocks: publicBlockIds,
    });
  }

  writeYaml(TARGET_INDEX_PATH, {
    ...sourceIndex,
    layers: publicLayers,
  });

  for (const fileName of ROOT_CONTRACT_FILES) {
    fs.copyFileSync(path.join(SOURCE_CONTRACT_DIR, fileName), path.join(TARGET_CONTRACT_DIR, fileName));
  }
}

try {
  buildPublicContract();
  console.log('✅ Public package contract assembled from core-contract');
} catch (error) {
  console.error(`❌ Failed to assemble public package contract: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
