import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { CanonIndex } from './types.ts';

export const CANON_CANDIDATES = [
  'contract/canon.index.yaml',
  'contract/canon.cbmd.yaml',
] as const;

export interface LoadedCanonDocument {
  rootDir: string;
  canonPath: string;
  raw: string;
  parsed: Record<string, any>;
  modular: boolean;
}

export function resolveCanonPath(rootDir: string, requestedPath?: string): string {
  const envCanonPath = process.env.FRIDA_CANON_PATH;
  const effectiveRequestedPath = requestedPath || (envCanonPath && envCanonPath.trim() ? envCanonPath : undefined);

  if (effectiveRequestedPath) {
    const absoluteRequestedPath = path.resolve(rootDir, effectiveRequestedPath);
    if (!fs.existsSync(absoluteRequestedPath)) {
      throw new Error(`Canon file not found: ${absoluteRequestedPath}`);
    }
    return absoluteRequestedPath;
  }

  for (const candidate of CANON_CANDIDATES) {
    const absoluteCandidatePath = path.resolve(rootDir, candidate);
    if (fs.existsSync(absoluteCandidatePath)) {
      return absoluteCandidatePath;
    }
  }

  throw new Error(
    `No canon file found. Checked: ${CANON_CANDIDATES.map((item) => path.resolve(rootDir, item)).join(', ')}`
  );
}

function isIndexFile(canonPath: string): boolean {
  return path.basename(canonPath) === 'canon.index.yaml';
}

function loadModularCanon(canonPath: string): Record<string, any> {
  const indexDir = path.dirname(canonPath);
  const indexRaw = fs.readFileSync(canonPath, 'utf-8');
  const index = yaml.parse(indexRaw) as CanonIndex;

  if (!index?.canon_index?.layers || !Array.isArray(index.canon_index.layers)) {
    throw new Error(`Invalid canon index: missing canon_index.layers at ${canonPath}`);
  }

  const assembled: Record<string, any> = {};

  for (const layer of index.canon_index.layers) {
    const layerPath = path.resolve(indexDir, layer.path);
    if (!fs.existsSync(layerPath)) {
      throw new Error(`Canon layer file not found: ${layerPath} (layer: ${layer.id})`);
    }
    const layerRaw = fs.readFileSync(layerPath, 'utf-8');
    const layerParsed = yaml.parse(layerRaw);

    if (!layerParsed || typeof layerParsed !== 'object') {
      throw new Error(`Canon layer parsed into non-object value: ${layerPath}`);
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

export function loadCanonDocument(rootDir: string, requestedPath?: string): LoadedCanonDocument {
  const canonicalRoot = path.resolve(rootDir);
  const canonPath = resolveCanonPath(canonicalRoot, requestedPath);
  const modular = isIndexFile(canonPath);

  if (modular) {
    const parsed = loadModularCanon(canonPath);
    const raw = yaml.stringify(parsed);

    if (!parsed.meta || !parsed.core) {
      throw new Error(`Assembled modular canon is missing required 'meta' and/or 'core' blocks`);
    }

    return { rootDir: canonicalRoot, canonPath, raw, parsed, modular: true };
  }

  const raw = fs.readFileSync(canonPath, 'utf-8');
  const parsed = yaml.parse(raw);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Canon parsed into non-object value: ${canonPath}`);
  }

  return { rootDir: canonicalRoot, canonPath, raw, parsed, modular: false };
}
