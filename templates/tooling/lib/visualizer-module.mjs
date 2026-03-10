import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(MODULE_DIR, '../../..');
const CORE_CONTRACT_INDEX = path.join(PACKAGE_ROOT, 'contract', 'contract.index.yaml');

function isObjectLike(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function loadContractIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Core contract index not found: ${indexPath}`);
  }
  const index = yaml.parse(fs.readFileSync(indexPath, 'utf8'));
  const layers = Array.isArray(index?.layers) ? index.layers : null;
  if (!layers) {
    throw new Error(`Invalid core contract index: missing layers at ${indexPath}`);
  }

  const contract = {};
  const indexDir = path.dirname(indexPath);
  const repoRoot = path.resolve(indexDir, '..');
  for (const layer of layers) {
    if (typeof layer?.path !== 'string' || !layer.path.trim()) {
      continue;
    }
    const layerPathFromIndexDir = path.resolve(indexDir, layer.path);
    const layerPathFromRepoRoot = path.resolve(repoRoot, layer.path);
    const layerPath = fs.existsSync(layerPathFromIndexDir) ? layerPathFromIndexDir : layerPathFromRepoRoot;
    if (!fs.existsSync(layerPath)) {
      throw new Error(`Core contract layer not found: ${layer.path}`);
    }
    Object.assign(contract, yaml.parse(fs.readFileSync(layerPath, 'utf8')));
  }

  if (!isObjectLike(contract)) {
    throw new Error('Core contract parsed into a non-object value.');
  }
  return contract;
}

export function resolvePathRef(paths, ref) {
  if (!isObjectLike(paths) || typeof ref !== 'string' || !ref.trim()) {
    return null;
  }

  const parts = ref.split('.');
  if (parts[0] !== 'PATHS') {
    return null;
  }

  let cursor = { PATHS: paths };
  for (const part of parts) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' && cursor.trim() ? cursor : null;
}

export function loadCorePackageContract() {
  return loadContractIndex(CORE_CONTRACT_INDEX);
}

export function loadVisualizerModuleConfig() {
  const contract = loadCorePackageContract();
  const referenceViewer = isObjectLike(contract.FRIDA_VISUAL?.reference_viewer)
    ? contract.FRIDA_VISUAL.reference_viewer
    : {};
  const moduleRootDirRef = typeof referenceViewer.module_rootDirRef === 'string'
    ? referenceViewer.module_rootDirRef
    : null;
  const moduleRootDir = moduleRootDirRef ? resolvePathRef(contract.PATHS, moduleRootDirRef) : null;
  const moduleRootAbs = moduleRootDir ? path.join(PACKAGE_ROOT, moduleRootDir) : null;

  return {
    contract,
    enabled: Boolean(moduleRootDir),
    moduleRootDirRef,
    moduleRootDir,
    moduleRootAbs,
    moduleDistAbs: moduleRootAbs ? path.join(moduleRootAbs, 'dist') : null,
  };
}

export function resolveVisualizerModuleDistFile(fileName) {
  const config = loadVisualizerModuleConfig();
  if (!config.enabled || !config.moduleDistAbs) {
    return null;
  }
  return path.join(config.moduleDistAbs, fileName);
}
