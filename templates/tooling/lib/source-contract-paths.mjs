import fs from 'node:fs';
import path from 'node:path';

export const CORE_CONTRACT_INDEX_REL = 'core-contract/contract.index.yaml';
export const PUBLIC_CONTRACT_INDEX_REL = 'contract/contract.index.yaml';
export const CORE_CONTRACT_LAYER_DIR_REL = 'core-contract/layers';
export const PUBLIC_CONTRACT_LAYER_DIR_REL = 'contract/public-layers';
export const PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX = 'public-layers';
export const PUBLIC_CONTRACT_LAYER_FILE_SUFFIX = '.public.yaml';
export const PUBLIC_CONTRACT_PROJECTION_KIND = 'public_package_projection';
export const CORE_TEMPLATE_INTEGRITY_MANIFEST_REL = 'core-contract/template-integrity.manifest.yaml';
export const PUBLIC_TEMPLATE_INTEGRITY_MANIFEST_REL = 'contract/template-integrity.manifest.yaml';
export const CORE_BOOTSTRAP_MANIFEST_REL = 'core-contract/bootstrap-package.manifest.yaml';
export const PUBLIC_BOOTSTRAP_MANIFEST_REL = 'contract/bootstrap-package.manifest.yaml';

function toAbsolute(rootDir, relativePath) {
  return path.resolve(rootDir, relativePath);
}

export function hasCoreAuthoringSurface(rootDir = process.cwd()) {
  return fs.existsSync(toAbsolute(rootDir, CORE_CONTRACT_INDEX_REL));
}

export function resolveSourceContractIndexRel(rootDir = process.cwd()) {
  return hasCoreAuthoringSurface(rootDir) ? CORE_CONTRACT_INDEX_REL : PUBLIC_CONTRACT_INDEX_REL;
}

export function toPublicContractLayerFileName(fileName) {
  const normalized = String(fileName || '').replace(/\\/g, '/').trim();
  if (!normalized) {
    return PUBLIC_CONTRACT_LAYER_FILE_SUFFIX.slice(1);
  }
  const parsed = path.posix.parse(normalized);
  const baseName = parsed.ext ? parsed.name : parsed.base;
  return `${baseName}${PUBLIC_CONTRACT_LAYER_FILE_SUFFIX}`;
}

export function toPublicContractLayerIndexPath(fileName) {
  return `${PUBLIC_CONTRACT_LAYER_DIR_FROM_INDEX}/${toPublicContractLayerFileName(fileName)}`;
}

export function resolveSourceContractLayerRel(fileName, rootDir = process.cwd()) {
  const useCoreAuthoringSurface = hasCoreAuthoringSurface(rootDir);
  const baseDir = useCoreAuthoringSurface ? CORE_CONTRACT_LAYER_DIR_REL : PUBLIC_CONTRACT_LAYER_DIR_REL;
  const effectiveFileName = useCoreAuthoringSurface ? fileName : toPublicContractLayerFileName(fileName);
  return `${baseDir}/${effectiveFileName}`;
}

export function resolveSourceTemplateIntegrityManifestRel(rootDir = process.cwd()) {
  return hasCoreAuthoringSurface(rootDir) ? CORE_TEMPLATE_INTEGRITY_MANIFEST_REL : PUBLIC_TEMPLATE_INTEGRITY_MANIFEST_REL;
}

export function resolveSourceBootstrapManifestRel(rootDir = process.cwd()) {
  return hasCoreAuthoringSurface(rootDir) ? CORE_BOOTSTRAP_MANIFEST_REL : PUBLIC_BOOTSTRAP_MANIFEST_REL;
}
