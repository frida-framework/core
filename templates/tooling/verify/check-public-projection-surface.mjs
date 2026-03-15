#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import {
  CORE_CONTRACT_INDEX_REL,
  PUBLIC_CONTRACT_INDEX_REL,
  PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX,
  PUBLIC_CONTRACT_LAYER_DIR_REL,
  PUBLIC_CONTRACT_LAYER_FILE_SUFFIX,
  PUBLIC_CONTRACT_PROJECTION_KIND,
  toPublicContractLayerIndexPath,
} from '../lib/source-contract-paths.mjs';

const ROOT_DIR = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readYaml(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return YAML.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function getLayers(indexDoc) {
  if (Array.isArray(indexDoc?.layers)) {
    return indexDoc.layers;
  }
  if (Array.isArray(indexDoc?.contract_index?.layers)) {
    return indexDoc.contract_index.layers;
  }
  return [];
}

function walkYamlFiles(dirPath, files = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkYamlFiles(absolutePath, files);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(absolutePath);
    }
  }
  return files;
}

const publicIndex = readYaml(PUBLIC_CONTRACT_INDEX_REL);
const publicLayers = getLayers(publicIndex);
const projection = publicIndex?.projection;

if (!isPlainObject(projection)) {
  fail(`${PUBLIC_CONTRACT_INDEX_REL}: projection metadata is required for the public package surface`);
} else {
  if (projection.kind !== PUBLIC_CONTRACT_PROJECTION_KIND) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: projection.kind must equal ${PUBLIC_CONTRACT_PROJECTION_KIND}`);
  }
  if (projection.layer_dir !== PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: projection.layer_dir must equal ${PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX}`);
  }
  if (projection.layer_file_suffix !== PUBLIC_CONTRACT_LAYER_FILE_SUFFIX) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: projection.layer_file_suffix must equal ${PUBLIC_CONTRACT_LAYER_FILE_SUFFIX}`);
  }
}

if (publicLayers.length === 0) {
  fail(`${PUBLIC_CONTRACT_INDEX_REL}: public layer list is empty`);
}

const publicLayerDirAbs = path.join(ROOT_DIR, PUBLIC_CONTRACT_LAYER_DIR_REL);
if (!fs.existsSync(publicLayerDirAbs) || !fs.statSync(publicLayerDirAbs).isDirectory()) {
  fail(`${PUBLIC_CONTRACT_LAYER_DIR_REL}: public projection layer directory is missing`);
}

const legacyLayerDirAbs = path.join(ROOT_DIR, 'contract', 'layers');
if (fs.existsSync(legacyLayerDirAbs) && fs.statSync(legacyLayerDirAbs).isDirectory()) {
  const legacyEntries = fs.readdirSync(legacyLayerDirAbs);
  if (legacyEntries.length > 0) {
    fail('contract/layers/: legacy public layer directory must stay empty or absent');
  }
}

const coreIndexPath = path.join(ROOT_DIR, CORE_CONTRACT_INDEX_REL);
const coreLayersById = new Map();
if (fs.existsSync(coreIndexPath)) {
  const coreIndex = readYaml(CORE_CONTRACT_INDEX_REL);
  for (const layer of getLayers(coreIndex)) {
    if (typeof layer?.id === 'string') {
      coreLayersById.set(layer.id, layer);
    }
  }
}

for (const layer of publicLayers) {
  if (!isPlainObject(layer)) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: each layer entry must be an object`);
    continue;
  }

  const layerId = String(layer.id || '');
  const layerPath = String(layer.path || '').replace(/\\/g, '/');
  if (!layerPath.startsWith(`${PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX}/`)) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: ${layerId || '<unknown>'} must resolve under ${PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX}/`);
    continue;
  }

  const layerFileName = path.posix.basename(layerPath);
  if (!layerFileName.endsWith(PUBLIC_CONTRACT_LAYER_FILE_SUFFIX)) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: ${layerId || '<unknown>'} must use the ${PUBLIC_CONTRACT_LAYER_FILE_SUFFIX} suffix`);
  }

  const publicLayerAbs = path.resolve(path.dirname(path.join(ROOT_DIR, PUBLIC_CONTRACT_INDEX_REL)), layerPath);
  if (!fs.existsSync(publicLayerAbs)) {
    fail(`${PUBLIC_CONTRACT_INDEX_REL}: ${layerId || '<unknown>'} points to a missing layer file ${layerPath}`);
    continue;
  }

  const publicLayerDoc = YAML.parse(fs.readFileSync(publicLayerAbs, 'utf8'));
  if (!isPlainObject(publicLayerDoc)) {
    fail(`${layerPath}: projected layer must parse into an object`);
    continue;
  }

  const declaredBlocks = Array.isArray(layer.blocks) ? layer.blocks.filter((value) => typeof value === 'string') : [];
  for (const blockId of declaredBlocks) {
    if (!(blockId in publicLayerDoc)) {
      fail(`${layerPath}: missing declared block ${blockId}`);
    }
  }

  if (Object.keys(publicLayerDoc).length !== declaredBlocks.length) {
    fail(`${layerPath}: projected layer must expose exactly the declared public blocks`);
  }

  if (coreLayersById.has(layerId)) {
    const sourceLayer = coreLayersById.get(layerId);
    const sourceLayerPath = String(sourceLayer?.path || '').replace(/\\/g, '/');
    const sourceLayerFileName = path.posix.basename(sourceLayerPath);
    const expectedLayerPath = toPublicContractLayerIndexPath(sourceLayerFileName);

    if (layerPath !== expectedLayerPath) {
      fail(`${PUBLIC_CONTRACT_INDEX_REL}: ${layerId} must project to ${expectedLayerPath} (received ${layerPath})`);
    }

    if (layerFileName === sourceLayerFileName) {
      fail(`${PUBLIC_CONTRACT_INDEX_REL}: ${layerId} reuses the authoring filename ${sourceLayerFileName}; projection files must stay distinct`);
    }

    const sourceLayerDoc = readYaml(sourceLayerPath);
    for (const blockId of declaredBlocks) {
      if (!(blockId in sourceLayerDoc)) {
        fail(`${layerPath}: declared block ${blockId} does not exist in source layer ${sourceLayerPath}`);
      }
    }
  }
}

if (fs.existsSync(publicLayerDirAbs) && fs.statSync(publicLayerDirAbs).isDirectory()) {
  const actualLayerFiles = walkYamlFiles(publicLayerDirAbs).map((absolutePath) =>
    path.relative(path.dirname(path.join(ROOT_DIR, PUBLIC_CONTRACT_INDEX_REL)), absolutePath).replace(/\\/g, '/'),
  );
  const declaredLayerFiles = new Set(publicLayers.map((layer) => String(layer?.path || '').replace(/\\/g, '/')));
  for (const relativePath of actualLayerFiles) {
    if (!declaredLayerFiles.has(relativePath)) {
      fail(`${relativePath}: exists on disk but is not declared in ${PUBLIC_CONTRACT_INDEX_REL}`);
    }
  }
}

for (const absolutePath of walkYamlFiles(path.join(ROOT_DIR, 'contract'))) {
  const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, '/');
  const raw = fs.readFileSync(absolutePath, 'utf8');
  if (raw.includes('contract/layers/FL')) {
    fail(`${relativePath}: contains legacy contract/layers/ reference`);
  }
  if (raw.includes('core-contract/layers/FL')) {
    fail(`${relativePath}: contains leaked core-contract/layers/ reference`);
  }
}

if (readText(PUBLIC_CONTRACT_INDEX_REL).includes('contract/layers/FL')) {
  fail(`${PUBLIC_CONTRACT_INDEX_REL}: legacy contract/layers/ references must not remain`);
}

if (failures.length > 0) {
  console.error('Public projection surface check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Public projection surface check passed');
