import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

export const FRIDA_ROOT_ALLOWED_FILES = ['AGENTS.md', 'config.yaml'] as const;

/** Baseline fallback used only when the frida-core contract mirror is unavailable (e.g., pre-bootstrap). */
export const FRIDA_ROOT_ALLOWED_DIRS_BASELINE = ['contract', 'inbox', 'reports', 'templates'] as const;

/** Relative path from repo root to the frida-core contract mirror index. */
export const FRIDA_CORE_CONTRACT_MIRROR_PATH = '.frida/contract/frida/contract.index.yaml';

/**
 * Loads allowed_dirs from FRIDA_ROOT_LAYOUT_POLICY in the frida-core contract mirror.
 * Falls back to FRIDA_ROOT_ALLOWED_DIRS_BASELINE if the mirror is not found.
 * This ensures the contract is the single source of truth — no drift between YAML and code.
 */
export function loadAllowedDirs(rootDir: string): string[] {
  const absoluteRoot = path.resolve(rootDir);
  const mirrorIndexPath = path.resolve(absoluteRoot, FRIDA_CORE_CONTRACT_MIRROR_PATH);

  if (!fs.existsSync(mirrorIndexPath)) {
    return [...FRIDA_ROOT_ALLOWED_DIRS_BASELINE];
  }

  try {
    const indexRaw = fs.readFileSync(mirrorIndexPath, 'utf-8');
    const index = yaml.parse(indexRaw) as { layers?: Array<{ path: string }> };
    const layers = Array.isArray(index?.layers) ? index.layers : [];
    const mirrorDir = path.dirname(mirrorIndexPath);

    for (const layer of layers) {
      if (typeof layer?.path !== 'string') continue;
      // Mirror flattens the contract/ prefix: contract/layers/foo.yaml → layers/foo.yaml under mirrorDir.
      // Try: (1) relative to mirrorDir as-is, (2) strip first path segment then relative to mirrorDir, (3) relative to rootDir.
      const stripped = layer.path.replace(/^[^/]+\//, ''); // removes leading "contract/"
      const candidates = [
        path.resolve(mirrorDir, layer.path),
        path.resolve(mirrorDir, stripped),
        path.resolve(absoluteRoot, layer.path),
      ];
      const layerPath = candidates.find((p) => fs.existsSync(p));
      if (!layerPath) continue;
      const layerParsed = yaml.parse(fs.readFileSync(layerPath, 'utf-8')) as Record<string, any>;
      const policy = layerParsed?.FRIDA_ROOT_LAYOUT_POLICY;
      if (policy && Array.isArray(policy.allowed_dirs)) {
        return policy.allowed_dirs.filter((d: unknown) => typeof d === 'string');
      }
    }
  } catch {
    // If anything goes wrong, fall back to baseline
  }

  return [...FRIDA_ROOT_ALLOWED_DIRS_BASELINE];
}

export type FridaRootLayoutValidationMode = 'warn' | 'fail';

export interface FridaRootLayoutState {
  rootDir: string;
  fridaDir: string;
  exists: boolean;
  files: string[];
  dirs: string[];
  otherEntries: string[];
}

export interface FridaRootLayoutValidationResult extends FridaRootLayoutState {
  ok: boolean;
  issues: string[];
}

export class FridaRootLayoutError extends Error {
  constructor(public readonly issues: string[], message?: string) {
    super(message || `FRIDA root layout validation failed (${issues.length} issue(s))`);
  }
}

function listSorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sameSet(actual: string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((item, index) => item === expected[index]);
}

export function inspectFridaRootLayout(rootDir: string): FridaRootLayoutState {
  const absoluteRoot = path.resolve(rootDir);
  const fridaDir = path.resolve(absoluteRoot, '.frida');
  if (!fs.existsSync(fridaDir) || !fs.statSync(fridaDir).isDirectory()) {
    return {
      rootDir: absoluteRoot,
      fridaDir,
      exists: false,
      files: [],
      dirs: [],
      otherEntries: [],
    };
  }

  const files: string[] = [];
  const dirs: string[] = [];
  const otherEntries: string[] = [];
  for (const entry of fs.readdirSync(fridaDir, { withFileTypes: true })) {
    if (entry.isFile()) {
      files.push(entry.name);
      continue;
    }
    if (entry.isDirectory()) {
      dirs.push(entry.name);
      continue;
    }
    otherEntries.push(entry.name);
  }

  return {
    rootDir: absoluteRoot,
    fridaDir,
    exists: true,
    files: listSorted(files),
    dirs: listSorted(dirs),
    otherEntries: listSorted(otherEntries),
  };
}

export function getFridaRootLayoutValidation(rootDir: string): FridaRootLayoutValidationResult {
  const state = inspectFridaRootLayout(rootDir);
  const issues: string[] = [];

  if (!state.exists) {
    issues.push('missing .frida/ directory');
  }

  const expectedFiles = listSorted(FRIDA_ROOT_ALLOWED_FILES);
  if (!sameSet(state.files, expectedFiles)) {
    const actualSet = new Set(state.files);
    const expectedSet = new Set(expectedFiles);
    const missing = expectedFiles.filter((name) => !actualSet.has(name));
    const unexpected = state.files.filter((name) => !expectedSet.has(name));
    if (missing.length > 0) {
      issues.push(`missing required .frida root file(s): ${missing.join(', ')}`);
    }
    if (unexpected.length > 0) {
      issues.push(`unexpected .frida root file(s): ${unexpected.join(', ')}`);
    }
    if (state.files.length !== expectedFiles.length) {
      issues.push(`.frida root must contain exactly ${expectedFiles.length} file(s); found ${state.files.length}`);
    }
  }

  const allowedDirs = new Set(loadAllowedDirs(rootDir));
  const unexpectedDirs = state.dirs.filter((name) => !allowedDirs.has(name));
  if (unexpectedDirs.length > 0) {
    issues.push(`unexpected .frida root director${unexpectedDirs.length === 1 ? 'y' : 'ies'}: ${unexpectedDirs.join(', ')}`);
  }

  if (state.otherEntries.length > 0) {
    issues.push(`unsupported .frida root entries (non-file/non-directory): ${state.otherEntries.join(', ')}`);
  }

  return {
    ...state,
    ok: issues.length === 0,
    issues,
  };
}

export function validateFridaRootLayout(
  rootDir: string,
  mode: FridaRootLayoutValidationMode = 'warn'
): FridaRootLayoutValidationResult {
  const result = getFridaRootLayoutValidation(rootDir);
  if (result.ok) {
    return result;
  }

  const details = result.issues.map((issue) => `- ${issue}`).join('\n');
  const message = `FRIDA root layout policy violation (.frida):\n${details}`;

  if (mode === 'fail') {
    throw new FridaRootLayoutError(result.issues, message);
  }

  console.warn(`⚠️  ${message.replace(/\n/g, '\n⚠️  ')}`);
  return result;
}
