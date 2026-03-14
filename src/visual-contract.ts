import * as path from 'path';
import * as yaml from 'yaml';
import { fileURLToPath } from 'url';
import { loadContractDocument, type LoadedContractDocument } from './contract-path.ts';

type AnyObject = Record<string, unknown>;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');
const CANONICAL_VISUAL_OVERLAY_PATH_REF = 'PATHS.visual.overlayFile';

let cachedCoreVisualContract: AnyObject | null = null;

function isObjectLike(value: unknown): value is AnyObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneNode<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneNode(item)) as T;
  }
  if (isObjectLike(value)) {
    const out: AnyObject = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneNode(item);
    }
    return out as T;
  }
  return value;
}

function mergeObjects(base: AnyObject, override: AnyObject): AnyObject {
  const out: AnyObject = cloneNode(base);
  for (const [key, value] of Object.entries(override)) {
    if (isObjectLike(out[key]) && isObjectLike(value)) {
      out[key] = mergeObjects(out[key] as AnyObject, value);
      continue;
    }
    out[key] = cloneNode(value);
  }
  return out;
}

function resolvePathRef(pathsBlock: AnyObject, ref: unknown): string | null {
  if (!isObjectLike(pathsBlock) || typeof ref !== 'string' || !ref.trim() || !ref.startsWith('PATHS.')) {
    return null;
  }

  let cursor: unknown = { PATHS: pathsBlock };
  for (const part of ref.split('.')) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' && cursor.trim() ? cursor.trim() : null;
}

function resolveLegacyOverlayPath(contract: AnyObject): string | null {
  const fridaConfigVisual =
    isObjectLike(contract.FRIDA_CONFIG) && isObjectLike(contract.FRIDA_CONFIG.visual)
      ? (contract.FRIDA_CONFIG.visual as AnyObject)
      : null;
  const fromConfig = resolvePathRef(
    (isObjectLike(contract.PATHS) ? contract.PATHS : {}) as AnyObject,
    fridaConfigVisual?.overlay_pathRef || fridaConfigVisual?.overlay_outputFileRef
  );
  if (fromConfig) {
    return fromConfig;
  }

  const paths = isObjectLike(contract.PATHS) ? (contract.PATHS as AnyObject) : null;
  const visual = paths && isObjectLike(paths.visual) ? (paths.visual as AnyObject) : null;
  if (typeof visual?.overlayFile === 'string' && visual.overlayFile.trim()) {
    return visual.overlayFile.trim();
  }

  const frida = paths && isObjectLike(paths.frida) ? (paths.frida as AnyObject) : null;
  const fridaContractNested = frida && isObjectLike(frida.contract) ? (frida.contract as AnyObject) : null;
  const fridaContractNestedVisual =
    fridaContractNested && isObjectLike(fridaContractNested.visual)
      ? (fridaContractNested.visual as AnyObject)
      : null;
  if (typeof fridaContractNestedVisual?.overlayFile === 'string' && fridaContractNestedVisual.overlayFile.trim()) {
    return fridaContractNestedVisual.overlayFile.trim();
  }

  if (typeof frida?.visualOverlayFile === 'string' && frida.visualOverlayFile.trim()) {
    return frida.visualOverlayFile.trim();
  }

  const fridaContract = paths && isObjectLike(paths.fridaContract) ? (paths.fridaContract as AnyObject) : null;
  if (typeof fridaContract?.visualOverlayFile === 'string' && fridaContract.visualOverlayFile.trim()) {
    return fridaContract.visualOverlayFile.trim();
  }

  return null;
}

function loadCoreVisualContract(): AnyObject {
  if (!cachedCoreVisualContract) {
    const loaded = loadContractDocument(PACKAGE_ROOT, 'contract/contract.index.yaml');
    if (!isObjectLike(loaded.parsed)) {
      throw new Error('Core contract parsed into a non-object value.');
    }
    cachedCoreVisualContract = loaded.parsed as AnyObject;
  }
  return cloneNode(cachedCoreVisualContract);
}

export function composeEffectiveVisualContract(appContract: AnyObject, coreContract: AnyObject): AnyObject {
  if (!isObjectLike(coreContract.FRIDA_VISUAL)) {
    throw new Error('Core contract is missing FRIDA_VISUAL.');
  }

  const merged = cloneNode(appContract);
  const mergedPaths = isObjectLike(merged.PATHS) ? (merged.PATHS as AnyObject) : {};
  const corePaths = isObjectLike(coreContract.PATHS) ? (coreContract.PATHS as AnyObject) : {};
  const appOverlayPath = resolveLegacyOverlayPath(merged);

  const nextVisualPaths = mergeObjects(
    isObjectLike(corePaths.visual) ? (corePaths.visual as AnyObject) : {},
    isObjectLike(mergedPaths.visual) ? (mergedPaths.visual as AnyObject) : {}
  );
  if ((!nextVisualPaths.overlayFile || typeof nextVisualPaths.overlayFile !== 'string') && appOverlayPath) {
    nextVisualPaths.overlayFile = appOverlayPath;
  }
  if ((!nextVisualPaths.overlayDir || typeof nextVisualPaths.overlayDir !== 'string') && typeof nextVisualPaths.overlayFile === 'string') {
    nextVisualPaths.overlayDir = path.posix.dirname(nextVisualPaths.overlayFile);
  }

  const nextToolingPaths = mergeObjects(
    isObjectLike(corePaths.tooling) ? (corePaths.tooling as AnyObject) : {},
    isObjectLike(mergedPaths.tooling) ? (mergedPaths.tooling as AnyObject) : {}
  );

  merged.PATHS = mergeObjects(mergedPaths, {
    visual: nextVisualPaths,
    tooling: nextToolingPaths,
  });

  const fridaConfig = isObjectLike(merged.FRIDA_CONFIG) ? (merged.FRIDA_CONFIG as AnyObject) : {};
  const visualConfig = isObjectLike(fridaConfig.visual) ? mergeObjects(fridaConfig.visual as AnyObject, {}) : {};
  delete visualConfig.overlay_outputFileRef;
  visualConfig.overlay_pathRef = CANONICAL_VISUAL_OVERLAY_PATH_REF;
  merged.FRIDA_CONFIG = mergeObjects(fridaConfig, {
    visual: visualConfig,
  });

  merged.FRIDA_VISUAL = cloneNode(coreContract.FRIDA_VISUAL);
  return merged;
}

export function loadEffectiveVisualContractDocument(
  rootDir: string,
  requestedPath?: string
): LoadedContractDocument {
  const loaded = loadContractDocument(rootDir, requestedPath);
  const parsed = composeEffectiveVisualContract(loaded.parsed as AnyObject, loadCoreVisualContract());
  return {
    ...loaded,
    parsed,
    raw: yaml.stringify(parsed),
  };
}
