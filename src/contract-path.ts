import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { ContractIndex } from './types.ts';

export const CONTRACT_CANDIDATES = [
  'contract/contract.index.yaml',
  'contract/contract.cbmd.yaml',
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

  return assembled;
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
