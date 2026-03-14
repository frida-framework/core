import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  DEPLOYED_MANAGEMENT_PLAYBOOK_PREFIX,
  PROJECTED_INTERNAL_ONLY_KEYS,
  PROJECTED_SOURCE_ONLY_PREFIXES,
  PROJECTED_STRING_REPLACEMENTS,
  SOURCE_MANAGEMENT_PLAYBOOK_PREFIX,
} from './frida-surface-policy.ts';
import { FRIDA_PACKAGE_NAME } from './identity.ts';

export const APP_CONTRACT_SOURCE_DIR_REL_PATH = '.frida/inbox/app-contract';
export const APP_CONTRACT_SOURCE_INDEX_REL_PATH = `${APP_CONTRACT_SOURCE_DIR_REL_PATH}/contract.index.yaml`;

export const APP_CONTRACT_INBOX_DIR_REL_PATH = APP_CONTRACT_SOURCE_DIR_REL_PATH;
export const APP_CONTRACT_INBOX_INDEX_REL_PATH = APP_CONTRACT_SOURCE_INDEX_REL_PATH;
export const FRIDA_CONTRACT_APP_MIRROR_DIR_REL_PATH = '.frida/contract/app';
export const FRIDA_CONTRACT_ENGINE_MIRROR_DIR_REL_PATH = '.frida/contract/frida';
export const FRIDA_TEMPLATES_DIR_REL_PATH = '.frida/templates';

const PROJECTED_INTERNAL_ONLY_KEY_SET = new Set(PROJECTED_INTERNAL_ONLY_KEYS);

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

function rewriteProjectedString(key: string | null, value: string, nonDeployableBlocks: Set<string>): string | undefined {
  if (isNonDeployableBlockRef(value, nonDeployableBlocks)) {
    return undefined;
  }

  if (key === 'source_playbook_ref') {
    return undefined;
  }

  if ((key === 'playbook_ref' || key === 'deployed_playbook_ref') && value.startsWith(SOURCE_MANAGEMENT_PLAYBOOK_PREFIX)) {
    return `${DEPLOYED_MANAGEMENT_PLAYBOOK_PREFIX}${value.slice(SOURCE_MANAGEMENT_PLAYBOOK_PREFIX.length)}`;
  }

  if (PROJECTED_SOURCE_ONLY_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return undefined;
  }

  let rewritten = value;
  for (const [from, to] of PROJECTED_STRING_REPLACEMENTS) {
    rewritten = rewritten.replaceAll(from, to);
  }

  return rewritten;
}

function sanitizeProjectedNode(node: unknown, nonDeployableBlocks: Set<string>, key: string | null = null): unknown {
  if (typeof node === 'string') {
    return rewriteProjectedString(key, node, nonDeployableBlocks);
  }

  if (Array.isArray(node)) {
    return node
      .map((item) => sanitizeProjectedNode(item, nonDeployableBlocks, key))
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
    if (PROJECTED_INTERNAL_ONLY_KEY_SET.has(key as (typeof PROJECTED_INTERNAL_ONLY_KEYS)[number])) {
      continue;
    }
    if (nonDeployableBlocks.has(key)) {
      continue;
    }
    const sanitized = sanitizeProjectedNode(value, nonDeployableBlocks, key);
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

function rewriteProjectedMirrorIndexPaths(targetDir: string): void {
  const indexPath = path.join(targetDir, 'contract.index.yaml');
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    return;
  }

  const parsed = yaml.parse(fs.readFileSync(indexPath, 'utf-8'));
  if (!isPlainObject(parsed) || !Array.isArray(parsed.layers)) {
    return;
  }

  for (const layer of parsed.layers) {
    if (!isPlainObject(layer) || typeof layer.path !== 'string') {
      continue;
    }
    if (layer.path.startsWith('contract/')) {
      layer.path = layer.path.slice('contract/'.length);
    }
  }

  fs.writeFileSync(indexPath, yaml.stringify(parsed, { lineWidth: 120 }), 'utf-8');
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
  for (const ref of ['PATHS.scripts.verify.checkAgentsContractSetFile', 'PATHS.tooling.verify.checkAgentsContractSetScript']) {
    const resolved = resolvePathRef(contract, ref);
    if (resolved) {
      return resolved;
    }
  }
  throw new ContractMirrorError(
    'APP_CONTRACT_INVALID',
    'target app contract is missing PATHS.scripts.verify.checkAgentsContractSetFile'
  );
}

function buildContractSetVerifierWrapper(): string {
  return `#!/usr/bin/env node
/**
 * AUTO-GENERATED FROM FRIDA CORE - DO NOT EDIT MANUALLY.
 *
 * This wrapper keeps the executable app entrypoint stable while the verifier
 * semantics remain owned by the Frida core package.
 */
import { runFridaAgentsContractSetCheck } from ${JSON.stringify(FRIDA_PACKAGE_NAME)};

if (typeof runFridaAgentsContractSetCheck !== 'function') {
  throw new Error('FRIDA core export "runFridaAgentsContractSetCheck" is missing');
}

const exitCode = runFridaAgentsContractSetCheck({ rootDir: process.cwd() });
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
  rewriteProjectedMirrorIndexPaths(targetDir);
  sanitizeProjectedContractMirror(targetDir, nonDeployableBlocks);
  return targetDir;
}

function emitDeployedToolingTemplates(targetRootDir: string, packageRootDir: string): string[] {
  const absoluteTargetRoot = path.resolve(targetRootDir);
  const absolutePackageRoot = path.resolve(packageRootDir);
  const sourceTemplatesRoot = path.resolve(absolutePackageRoot, 'templates');
  const sourceToolingDir = path.join(sourceTemplatesRoot, 'tooling');
  const sourceAgentsFile = path.join(sourceTemplatesRoot, 'AGENTS.md');

  ensureDirExists(sourceTemplatesRoot, 'FRIDA_TEMPLATES_SOURCE_MISSING', 'frida package templates directory');
  ensureDirExists(sourceToolingDir, 'FRIDA_TEMPLATES_SOURCE_MISSING', 'frida package tooling templates directory');
  ensureFileExists(sourceAgentsFile, 'FRIDA_TEMPLATES_SOURCE_MISSING', 'frida package templates AGENTS.md');

  const targetTemplatesRoot = path.resolve(absoluteTargetRoot, FRIDA_TEMPLATES_DIR_REL_PATH);
  const targetToolingDir = path.join(targetTemplatesRoot, 'tooling');
  const targetAgentsFile = path.join(targetTemplatesRoot, 'AGENTS.md');

  replaceDirectoryTree(sourceToolingDir, targetToolingDir);
  fs.mkdirSync(path.dirname(targetAgentsFile), { recursive: true });
  fs.copyFileSync(sourceAgentsFile, targetAgentsFile);

  return [targetAgentsFile, targetToolingDir];
}

export function emitCoreToolingEntrypoints(targetRootDir: string, packageRootDir: string, contract: Record<string, any>): string[] {
  const absoluteTargetRoot = path.resolve(targetRootDir);
  const verifierRelPath = resolveProjectedContractSetVerifierPath(contract);
  const verifierAbsPath = path.resolve(absoluteTargetRoot, verifierRelPath);

  fs.mkdirSync(path.dirname(verifierAbsPath), { recursive: true });
  fs.writeFileSync(verifierAbsPath, buildContractSetVerifierWrapper(), 'utf-8');

  return [verifierAbsPath, ...emitDeployedToolingTemplates(absoluteTargetRoot, packageRootDir)];
}
