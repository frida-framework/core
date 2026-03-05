import * as fs from 'fs';
import * as path from 'path';

export const APP_CONTRACT_SOURCE_DIR_REL_PATH = '.frida/inbox/app-contract';
export const APP_CONTRACT_SOURCE_INDEX_REL_PATH = `${APP_CONTRACT_SOURCE_DIR_REL_PATH}/contract.index.yaml`;

export const APP_CONTRACT_INBOX_DIR_REL_PATH = APP_CONTRACT_SOURCE_DIR_REL_PATH;
export const APP_CONTRACT_INBOX_INDEX_REL_PATH = APP_CONTRACT_SOURCE_INDEX_REL_PATH;
export const FRIDA_CONTRACT_APP_MIRROR_DIR_REL_PATH = '.frida/contract/app';
export const FRIDA_CONTRACT_ENGINE_MIRROR_DIR_REL_PATH = '.frida/contract/frida';
export const FRIDA_TEMPLATES_DIR_REL_PATH = '.frida/templates';

export class ContractMirrorError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function ensureDirExists(dirPath: string, code: string, label: string): void {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new ContractMirrorError(code, `${label} not found: ${dirPath}`);
  }
}

function ensureFileExists(filePath: string, code: string, label: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new ContractMirrorError(code, `${label} not found: ${filePath}`);
  }
}

function isNonEmptyDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return false;
  return fs.readdirSync(dirPath).length > 0;
}

function copyTreeContentsRecursive(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTreeContentsRecursive(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function replaceDirectoryTree(sourceDir: string, targetDir: string): void {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  copyTreeContentsRecursive(sourceDir, targetDir);
}

function resolvePathNode(contract: Record<string, any>, ref: string): any | null {
  if (typeof ref !== 'string' || !ref.startsWith('PATHS.')) {
    return null;
  }

  const parts = ref.split('.').slice(1);
  let cursor = contract.PATHS;

  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return cursor;
}

function resolvePathRef(contract: Record<string, any>, ref: string): string | null {
  const cursor = resolvePathNode(contract, ref);
  if (cursor === null) return null;
  if (typeof cursor === 'string' && cursor.trim()) return cursor;
  if (cursor && typeof cursor === 'object' && typeof cursor.contractical === 'string' && cursor.contractical.trim()) {
    return cursor.contractical;
  }
  return null;
}

function resolveProjectedContractSetVerifierPath(contract: Record<string, any>): string {
  const candidates = [
    'PATHS.tooling.verify.checkAgentsContractSetScript',
    'PATHS.tooling.verify.checkAgentsContractSet',
  ];

  for (const candidate of candidates) {
    const resolved = resolvePathRef(contract, candidate);
    if (resolved) {
      return resolved;
    }
  }

  return 'scripts/verify/check-agents-contract-set.mjs';
}

function buildContractSetVerifierWrapper(): string {
  return `#!/usr/bin/env node
/**
 * AUTO-GENERATED FROM FRIDA CORE - DO NOT EDIT MANUALLY.
 *
 * This wrapper keeps the executable app entrypoint stable while the verifier
 * semantics remain owned by the Frida core package.
 */

const CORE_PACKAGE_CANDIDATES = ['@frida-framework/core', '@hanszel/core'];

async function loadCore() {
  const failures = [];

  for (const candidate of CORE_PACKAGE_CANDIDATES) {
    try {
      return await import(candidate);
    } catch (error) {
      failures.push(\`\${candidate}: \${error instanceof Error ? error.message : String(error)}\`);
    }
  }

  throw new Error(\`Unable to load FRIDA core package. Tried: \${failures.join('; ')}\`);
}

const core = await loadCore();
const runVerifier = core.runFridaAgentsContractSetCheck;

if (typeof runVerifier !== 'function') {
  throw new Error('FRIDA core export "runFridaAgentsContractSetCheck" is missing');
}

const exitCode = runVerifier({ rootDir: process.cwd() });
process.exit(typeof exitCode === 'number' ? exitCode : 2);
`;
}

export function resolveAppContractSourceIndexPath(rootDir: string): string {
  return path.resolve(rootDir, APP_CONTRACT_SOURCE_INDEX_REL_PATH);
}

export const resolveAppContractInboxIndexPath = resolveAppContractSourceIndexPath;

export function assertAppContractSource(rootDir: string, contractPathAbs?: string): { sourceDir: string; indexFile: string } {
  const absoluteRoot = path.resolve(rootDir);
  const sourceDir = path.resolve(absoluteRoot, APP_CONTRACT_SOURCE_DIR_REL_PATH);
  const indexFile = path.resolve(absoluteRoot, APP_CONTRACT_SOURCE_INDEX_REL_PATH);

  if (contractPathAbs && path.resolve(contractPathAbs) !== indexFile) {
    throw new ContractMirrorError(
      'APP_CONTRACT_SOURCE_INVALID',
      `Frida app-side contractPath must point to ${APP_CONTRACT_SOURCE_INDEX_REL_PATH}; received ${path.relative(absoluteRoot, contractPathAbs) || contractPathAbs}`
    );
  }

  ensureDirExists(sourceDir, 'APP_CONTRACT_SOURCE_MISSING', 'app contract source directory');
  ensureFileExists(indexFile, 'APP_CONTRACT_SOURCE_MISSING', 'app contract source index');

  const layersDir = path.join(sourceDir, 'layers');
  if (!isNonEmptyDir(layersDir)) {
    throw new ContractMirrorError(
      'APP_CONTRACT_SOURCE_EMPTY',
      `app contract source layers are missing or empty: ${layersDir}`
    );
  }

  return { sourceDir, indexFile };
}

export const assertAppContractInboxSource = assertAppContractSource;

export function emitAppContractSourceMirror(rootDir: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const { sourceDir } = assertAppContractSource(absoluteRoot);
  const targetDir = path.resolve(absoluteRoot, FRIDA_CONTRACT_APP_MIRROR_DIR_REL_PATH);
  replaceDirectoryTree(sourceDir, targetDir);
  return targetDir;
}

export function emitFridaContractSourceMirror(targetRootDir: string, packageRootDir: string): string {
  const absoluteTargetRoot = path.resolve(targetRootDir);
  const absolutePackageRoot = path.resolve(packageRootDir);
  const sourceDir = path.resolve(absolutePackageRoot, 'contract');
  const sourceIndex = path.join(sourceDir, 'contract.index.yaml');
  ensureDirExists(sourceDir, 'FRIDA_CONTRACT_SOURCE_MISSING', 'frida package contract directory');
  ensureFileExists(sourceIndex, 'FRIDA_CONTRACT_SOURCE_MISSING', 'frida package contract index');

  const targetDir = path.resolve(absoluteTargetRoot, FRIDA_CONTRACT_ENGINE_MIRROR_DIR_REL_PATH);
  replaceDirectoryTree(sourceDir, targetDir);
  return targetDir;
}

export function emitTemplatesMirror(targetRootDir: string, packageRootDir: string): string {
  const absoluteTargetRoot = path.resolve(targetRootDir);
  const absolutePackageRoot = path.resolve(packageRootDir);
  const sourceDir = path.resolve(absolutePackageRoot, 'templates');
  ensureDirExists(sourceDir, 'FRIDA_TEMPLATES_SOURCE_MISSING', 'frida package templates directory');

  const targetDir = path.resolve(absoluteTargetRoot, FRIDA_TEMPLATES_DIR_REL_PATH);
  replaceDirectoryTree(sourceDir, targetDir);
  return targetDir;
}

export function emitCoreToolingEntrypoints(targetRootDir: string, contract: Record<string, any>): string[] {
  const absoluteTargetRoot = path.resolve(targetRootDir);
  const verifierRelPath = resolveProjectedContractSetVerifierPath(contract);
  const verifierAbsPath = path.resolve(absoluteTargetRoot, verifierRelPath);

  fs.mkdirSync(path.dirname(verifierAbsPath), { recursive: true });
  fs.writeFileSync(verifierAbsPath, buildContractSetVerifierWrapper(), 'utf-8');

  return [verifierAbsPath];
}
