import * as fs from 'fs';
import * as path from 'path';

export const FRIDA_ROOT_ALLOWED_FILES = ['config.yaml'] as const;
export const FRIDA_ROOT_ALLOWED_DIRS = ['contract', 'reports', 'inbox', 'templates'] as const;

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

  const allowedDirs = new Set(FRIDA_ROOT_ALLOWED_DIRS);
  const unexpectedDirs = state.dirs.filter((name) => !allowedDirs.has(name as (typeof FRIDA_ROOT_ALLOWED_DIRS)[number]));
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
