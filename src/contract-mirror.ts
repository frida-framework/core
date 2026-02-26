import * as fs from 'fs';
import * as path from 'path';

export const APP_CONTRACT_INBOX_DIR_REL_PATH = '.frida/inbox/app-contract';
export const APP_CONTRACT_INBOX_INDEX_REL_PATH = `${APP_CONTRACT_INBOX_DIR_REL_PATH}/contract.index.yaml`;
export const FRIDA_CONTRACT_APP_MIRROR_DIR_REL_PATH = '.frida/contract/app';
export const FRIDA_CONTRACT_ENGINE_MIRROR_DIR_REL_PATH = '.frida/contract/frida';

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

export function resolveAppContractInboxIndexPath(rootDir: string): string {
  return path.resolve(rootDir, APP_CONTRACT_INBOX_INDEX_REL_PATH);
}

export function assertAppContractInboxSource(rootDir: string, contractPathAbs?: string): { inboxDir: string; indexFile: string } {
  const absoluteRoot = path.resolve(rootDir);
  const inboxDir = path.resolve(absoluteRoot, APP_CONTRACT_INBOX_DIR_REL_PATH);
  const indexFile = path.resolve(absoluteRoot, APP_CONTRACT_INBOX_INDEX_REL_PATH);

  if (contractPathAbs && path.resolve(contractPathAbs) !== indexFile) {
    throw new ContractMirrorError(
      'APP_CONTRACT_INBOX_INVALID',
      `Frida app-side contractPath must point to ${APP_CONTRACT_INBOX_INDEX_REL_PATH}; received ${path.relative(absoluteRoot, contractPathAbs) || contractPathAbs}`
    );
  }

  ensureDirExists(inboxDir, 'APP_CONTRACT_INBOX_MISSING', 'app contract inbox directory');
  ensureFileExists(indexFile, 'APP_CONTRACT_INBOX_MISSING', 'app contract inbox index');

  const layersDir = path.join(inboxDir, 'layers');
  if (!isNonEmptyDir(layersDir)) {
    throw new ContractMirrorError(
      'APP_CONTRACT_INBOX_EMPTY',
      `app contract inbox layers are missing or empty: ${layersDir}`
    );
  }

  return { inboxDir, indexFile };
}

export function emitAppContractSourceMirror(rootDir: string): string {
  const absoluteRoot = path.resolve(rootDir);
  const { inboxDir } = assertAppContractInboxSource(absoluteRoot);
  const targetDir = path.resolve(absoluteRoot, FRIDA_CONTRACT_APP_MIRROR_DIR_REL_PATH);
  replaceDirectoryTree(inboxDir, targetDir);
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
