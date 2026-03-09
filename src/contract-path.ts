import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { ContractIndex } from './types.ts';

export const CONTRACT_CANDIDATES = [
  '.frida/inbox/app-contract/contract.index.yaml',
  'contract/contract.index.yaml',
] as const;

export interface LoadedContractDocument {
  rootDir: string;
  contractPath: string;
  raw: string;
  parsed: Record<string, any>;
  modular: boolean;
}

export function resolveContractPath(rootDir: string, requestedPath?: string): string {
  const envContractPath = process.env.FRIDA_CONTRACT_PATH;
  const effectiveRequestedPath = requestedPath || (envContractPath && envContractPath.trim() ? envContractPath : undefined);

  if (effectiveRequestedPath) {
    const normalizedRequestedPath = effectiveRequestedPath.replace(/\\/g, '/');
    if (normalizedRequestedPath === 'contract/contract.cbmd.yaml') {
      throw new Error(
        'Assembled snapshot contract is no longer supported. Use contract/contract.index.yaml or .frida/inbox/app-contract/contract.index.yaml.'
      );
    }
    const absoluteRequestedPath = path.resolve(rootDir, effectiveRequestedPath);
    if (!fs.existsSync(absoluteRequestedPath)) {
      throw new Error(`Contract file not found: ${absoluteRequestedPath}`);
    }
    return absoluteRequestedPath;
  }

  for (const candidate of CONTRACT_CANDIDATES) {
    const absoluteCandidatePath = path.resolve(rootDir, candidate);
    if (fs.existsSync(absoluteCandidatePath)) {
      return absoluteCandidatePath;
    }
  }

  throw new Error(
    `No contract file found. Checked: ${CONTRACT_CANDIDATES.map((item) => path.resolve(rootDir, item)).join(', ')}`
  );
}

function isIndexFile(contractPath: string): boolean {
  return path.basename(contractPath) === 'contract.index.yaml';
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneNode<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneNode(item)) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = cloneNode(item);
    }
    return out as T;
  }
  return value;
}

function mergeUniqueArrays(base: unknown[], incoming: unknown[]): unknown[] {
  const result = base.map((item) => cloneNode(item));
  const seen = new Set(result.map((item) => JSON.stringify(item)));
  for (const item of incoming) {
    const signature = JSON.stringify(item);
    if (seen.has(signature)) continue;
    result.push(cloneNode(item));
    seen.add(signature);
  }
  return result;
}

function mergeExtensionContribution(base: unknown, incoming: unknown, mergePath: string): unknown {
  if (base === undefined) {
    return cloneNode(incoming);
  }
  if (Array.isArray(base) && Array.isArray(incoming)) {
    return mergeUniqueArrays(base, incoming);
  }
  if (isPlainObject(base) && isPlainObject(incoming)) {
    const result: Record<string, any> = cloneNode(base);
    for (const [key, value] of Object.entries(incoming)) {
      result[key] = mergeExtensionContribution(result[key], value, `${mergePath}.${key}`);
    }
    return result;
  }
  if (base === incoming) {
    return base;
  }
  throw new Error(`App extension contribution conflict at ${mergePath}`);
}

function composeAppExtensions(assembled: Record<string, any>): Record<string, any> {
  const extensionEntries = Object.entries(assembled).filter(
    ([key, value]) => key.startsWith('APP_EXTENSION_') && isPlainObject(value),
  );

  if (extensionEntries.length === 0) {
    return assembled;
  }

  const activeExtensionIds = new Set<string>();
  for (const [blockKey, blockValue] of extensionEntries) {
    const id = blockValue.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(`App extension block ${blockKey} is missing a non-empty id`);
    }
    if (activeExtensionIds.has(id)) {
      throw new Error(`Duplicate active app extension id detected: ${id}`);
    }
    activeExtensionIds.add(id);
  }

  for (const [blockKey, blockValue] of extensionEntries) {
    const requires = Array.isArray(blockValue.requires) ? blockValue.requires : [];
    for (const requiredExtensionId of requires) {
      if (!activeExtensionIds.has(requiredExtensionId)) {
        throw new Error(
          `App extension block ${blockKey} requires missing active extension "${requiredExtensionId}". Activate the parent extension layer first.`,
        );
      }
    }
  }

  const composed: Record<string, any> = cloneNode(assembled);
  for (const [blockKey, blockValue] of extensionEntries) {
    const contributes = blockValue.contributes;
    if (!isPlainObject(contributes)) {
      continue;
    }
    for (const [targetBlock, contribution] of Object.entries(contributes)) {
      composed[targetBlock] = mergeExtensionContribution(
        composed[targetBlock],
        contribution,
        `${blockKey}.contributes.${targetBlock}`,
      );
    }
  }

  return composed;
}

function loadModularContract(contractPath: string): Record<string, any> {
  const indexDir = path.dirname(contractPath);
  const repoRoot = path.resolve(indexDir, '..');
  const indexRaw = fs.readFileSync(contractPath, 'utf-8');
  const index = yaml.parse(indexRaw) as ContractIndex;

  const layers = Array.isArray(index?.layers)
    ? index.layers
    : Array.isArray(index?.contract_index?.layers)
      ? index.contract_index.layers
      : null;

  if (!layers) {
    throw new Error(`Invalid contract index: missing layers (top-level) or contract_index.layers at ${contractPath}`);
  }

  const assembled: Record<string, any> = {};

  for (const layer of layers) {
    const layerPathFromIndexDir = path.resolve(indexDir, layer.path);
    const layerPathFromRepoRoot = path.resolve(repoRoot, layer.path);
    const layerPath = fs.existsSync(layerPathFromIndexDir)
      ? layerPathFromIndexDir
      : layerPathFromRepoRoot;
    if (!fs.existsSync(layerPath)) {
      throw new Error(
        `Contract layer file not found: ${layerPathFromIndexDir} or ${layerPathFromRepoRoot} (layer: ${layer.id})`
      );
    }
    const layerRaw = fs.readFileSync(layerPath, 'utf-8');
    const layerParsed = yaml.parse(layerRaw);

    if (!layerParsed || typeof layerParsed !== 'object') {
      throw new Error(`Contract layer parsed into non-object value: ${layerPath}`);
    }

    for (const [key, value] of Object.entries(layerParsed)) {
      if (key in assembled) {
        throw new Error(
          `Duplicate block "${key}" found in layer "${layer.id}" — already defined in a previous layer`
        );
      }
      assembled[key] = value;
    }
  }

  return composeAppExtensions(assembled);
}

export function loadContractDocument(rootDir: string, requestedPath?: string): LoadedContractDocument {
  const contracticalRoot = path.resolve(rootDir);
  const contractPath = resolveContractPath(contracticalRoot, requestedPath);
  const modular = isIndexFile(contractPath);

  if (modular) {
    const parsed = loadModularContract(contractPath);
    const raw = yaml.stringify(parsed);

    if (!parsed.meta || !parsed.core) {
      throw new Error(`Assembled modular contract is missing required 'meta' and/or 'core' blocks`);
    }

    return { rootDir: contracticalRoot, contractPath, raw, parsed, modular: true };
  }

  const raw = fs.readFileSync(contractPath, 'utf-8');
  const parsed = yaml.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Contract parsed into non-object value: ${contractPath}`);
  }

  return { rootDir: contracticalRoot, contractPath, raw, parsed, modular: false };
}
