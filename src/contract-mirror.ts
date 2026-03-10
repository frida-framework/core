import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectNonDeployableBlocks(sourceDir: string): Set<string> {
  const layersDir = path.join(sourceDir, 'layers');
  const blocks = new Set<string>();

  if (!fs.existsSync(layersDir) || !fs.statSync(layersDir).isDirectory()) {
    return blocks;
  }

  for (const entry of fs.readdirSync(layersDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue;
    const filePath = path.join(layersDir, entry.name);
    const parsed = yaml.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!isPlainObject(parsed)) continue;

    for (const [key, value] of Object.entries(parsed)) {
      if (!isPlainObject(value)) continue;
      if (value._visibility === 'private') {
        blocks.add(key);
      }
    }
  }

  return blocks;
}

function isNonDeployableBlockRef(value: string, nonDeployableBlocks: Set<string>): boolean {
  for (const block of nonDeployableBlocks) {
    if (value === block || value.startsWith(`${block}.`)) {
      return true;
    }
  }
  return false;
}

function sanitizeProjectedNode(node: unknown, nonDeployableBlocks: Set<string>): unknown {
  if (typeof node === 'string') {
    return isNonDeployableBlockRef(node, nonDeployableBlocks) ? undefined : node;
  }

  if (Array.isArray(node)) {
    return node
      .map((item) => sanitizeProjectedNode(item, nonDeployableBlocks))
      .filter((item) => item !== undefined);
  }

  if (!isPlainObject(node)) {
    return node;
  }

  const interfaceRef = node.interface_ref;
  const blockRef = node.block;
  if (typeof interfaceRef === 'string' && nonDeployableBlocks.has(interfaceRef)) {
    return undefined;
  }
  if (typeof blockRef === 'string' && nonDeployableBlocks.has(blockRef)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (nonDeployableBlocks.has(key)) {
      continue;
    }
    const sanitized = sanitizeProjectedNode(value, nonDeployableBlocks);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
}

function walkYamlFiles(dirPath: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkYamlFiles(entryPath, files);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(entryPath);
    }
  }
  return files;
}

function sanitizeProjectedContractMirror(targetDir: string, nonDeployableBlocks: Set<string>): void {
  if (nonDeployableBlocks.size === 0) {
    return;
  }

  for (const filePath of walkYamlFiles(targetDir)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.parse(raw);
    const sanitized = sanitizeProjectedNode(parsed, nonDeployableBlocks);
    if (!isPlainObject(sanitized)) {
      continue;
    }
    fs.writeFileSync(filePath, yaml.stringify(sanitized, { lineWidth: 120 }), 'utf-8');
  }
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

const CORE_PACKAGE_CANDIDATES = ['@frida-framework/core', '@frida-framework/core'];

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
  const nonDeployableBlocks = collectNonDeployableBlocks(sourceDir);
  replaceDirectoryTree(sourceDir, targetDir);
  sanitizeProjectedContractMirror(targetDir, nonDeployableBlocks);
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
