import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as yaml from 'yaml';
import { runFridaBootstrapCli } from './bootstrap.ts';
import { APP_CONTRACT_INBOX_INDEX_REL_PATH } from './contract-mirror.ts';
import { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
import { runFridaAgentsContractSetCheck } from './agents-contract-set.ts';
import {
  collectManifestTargetsForMode,
  loadBootstrapPackageManifest,
} from './bootstrap-manifest.ts';
import {
  BOOTLOADER_FORBIDDEN_REFERENCE_TOKENS,
  FORBIDDEN_LOCAL_CORE_PACKAGE_REFERENCE,
  PROJECTED_CORE_FORBIDDEN_TOKENS,
} from './frida-surface-policy.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

function getRequiredOutputs(): string[] {
  const { manifest } = loadBootstrapPackageManifest(PACKAGE_ROOT);
  return collectManifestTargetsForMode(manifest, 'zero-start', { kind: 'file' }).sort();
}

function getForbiddenOutputs(): string[] {
  const { manifest } = loadBootstrapPackageManifest(PACKAGE_ROOT);
  return collectManifestTargetsForMode(manifest, 'zero-start', {
    includeCleanupOnly: true,
  })
    .filter((target) => {
      const entry = manifest.entries.find((candidate) => candidate.target === target);
      return Boolean(entry?.cleanup_only);
    })
    .sort();
}

function listFiles(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      out.push(path.relative(rootDir, absolute).replace(/\\/g, '/'));
    }
  }

  out.sort();
  return out;
}

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function buildSnapshot(rootDir: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const relativePath of listFiles(rootDir)) {
    snapshot.set(relativePath, hashFile(path.join(rootDir, relativePath)));
  }
  return snapshot;
}

function assertRequiredOutputs(rootDir: string): void {
  const requiredOutputs = getRequiredOutputs();
  const missing = requiredOutputs.filter((relativePath) => !fs.existsSync(path.join(rootDir, relativePath)));
  if (missing.length > 0) {
    throw new Error(`zero-start is missing required outputs: ${missing.join(', ')}`);
  }
}

function assertForbiddenOutputsAbsent(rootDir: string): void {
  const forbiddenOutputs = getForbiddenOutputs();
  const present = forbiddenOutputs.filter((relativePath) => fs.existsSync(path.join(rootDir, relativePath)));
  if (present.length > 0) {
    throw new Error(`zero-start produced forbidden internal outputs: ${present.join(', ')}`);
  }
}

function assertBootloaderIsolation(rootDir: string): void {
  const bootloaderPath = path.join(rootDir, 'AGENTS.md');
  const raw = fs.readFileSync(bootloaderPath, 'utf-8');
  const violations = BOOTLOADER_FORBIDDEN_REFERENCE_TOKENS.filter((token) => raw.includes(token));
  if (violations.length > 0) {
    throw new Error(`zero-start bootloader leaked forbidden references: ${violations.join(', ')}`);
  }
}

function assertProjectedCoreMirrorSanitized(rootDir: string): void {
  const projectedRoot = path.join(rootDir, '.frida', 'contract', 'frida');
  const violations: string[] = [];

  for (const relativePath of listFiles(projectedRoot)) {
    const absolutePath = path.join(projectedRoot, relativePath);
    const raw = fs.readFileSync(absolutePath, 'utf-8');
    for (const token of PROJECTED_CORE_FORBIDDEN_TOKENS) {
      if (raw.includes(token)) {
        violations.push(`.frida/contract/frida/${relativePath} -> ${token}`);
      }
    }
  }

  const packageJsonRaw = fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8');
  if (packageJsonRaw.includes(FORBIDDEN_LOCAL_CORE_PACKAGE_REFERENCE)) {
    violations.push(`package.json -> ${FORBIDDEN_LOCAL_CORE_PACKAGE_REFERENCE}`);
  }

  if (violations.length > 0) {
    throw new Error(`zero-start leaked forbidden internal references:\n${violations.join('\n')}`);
  }
}

function assertProjectedCoreMirrorSelfContained(rootDir: string): void {
  const projectedRoot = path.join(rootDir, '.frida', 'contract', 'frida');
  const indexPath = path.join(projectedRoot, 'contract.index.yaml');
  const raw = fs.readFileSync(indexPath, 'utf-8');
  const parsed = yaml.parse(raw) as { layers?: Array<{ id?: string; path?: string }> };
  const layers = Array.isArray(parsed?.layers) ? parsed.layers : [];
  const missing: string[] = [];

  for (const layer of layers) {
    if (!layer?.path) continue;
    const absoluteLayerPath = path.resolve(projectedRoot, layer.path);
    if (!fs.existsSync(absoluteLayerPath)) {
      missing.push(`${layer.id || '<unknown>'}:${layer.path}`);
    }
  }

  if (missing.length > 0) {
    throw new Error(`projected core mirror is not self-contained; unresolved layer paths:\n${missing.join('\n')}`);
  }
}

function assertSnapshotsEqual(left: Map<string, string>, right: Map<string, string>): void {
  const leftKeys = [...left.keys()];
  const rightKeys = [...right.keys()];

  if (leftKeys.length !== rightKeys.length) {
    throw new Error(`file count mismatch: left=${leftKeys.length}, right=${rightKeys.length}`);
  }

  for (let i = 0; i < leftKeys.length; i++) {
    if (leftKeys[i] !== rightKeys[i]) {
      throw new Error(`file path mismatch at index ${i}: left=${leftKeys[i]}, right=${rightKeys[i]}`);
    }
  }

  for (const key of leftKeys) {
    const leftHash = left.get(key)!;
    const rightHash = right.get(key)!;
    if (leftHash !== rightHash) {
      throw new Error(`content hash mismatch for ${key}: left=${leftHash}, right=${rightHash}`);
    }
  }
}

async function runZoneCheck(rootDir: string, workingPath: string): Promise<void> {
  const previousRepoRoot = process.env.FRIDA_REPO_ROOT;
  const previousContractPath = process.env.FRIDA_CONTRACT_PATH;

  try {
    process.env.FRIDA_REPO_ROOT = rootDir;
    delete process.env.FRIDA_CONTRACT_PATH;

    const zoneCheckModuleUrl =
      `${pathToFileURL(path.join(PACKAGE_ROOT, 'dist', 'zone-check.js')).href}?root=${encodeURIComponent(rootDir)}&path=${encodeURIComponent(workingPath)}`;
    const zoneCheckModule = await import(zoneCheckModuleUrl);
    const result = zoneCheckModule.validateZoneAgentsMd(workingPath, APP_CONTRACT_INBOX_INDEX_REL_PATH);

    if (!result.zone_id || !result.exists) {
      throw new Error(result.error || 'zone validation failed');
    }
  } finally {
    if (previousRepoRoot === undefined) {
      delete process.env.FRIDA_REPO_ROOT;
    } else {
      process.env.FRIDA_REPO_ROOT = previousRepoRoot;
    }

    if (previousContractPath === undefined) {
      delete process.env.FRIDA_CONTRACT_PATH;
    } else {
      process.env.FRIDA_CONTRACT_PATH = previousContractPath;
    }
  }
}

async function runCliCheck(rootDir: string, args: string[]): Promise<void> {
  const commandLabel = args.join(' ');

  if (args.length === 1 && args[0] === 'migration-report') {
    const code = runFridaMigrationReport({ rootDir, contractPath: APP_CONTRACT_INBOX_INDEX_REL_PATH });
    if (code !== 0) {
      throw new Error(`CLI check failed (${commandLabel}): exit=${code}`);
    }
    return;
  }

  if (args.length >= 1 && args[0] === 'bootstrap') {
    const forwardedArgs = args.slice(1).map((value, index, array) => (
      value === '.' && array[index - 1] === '--target' ? rootDir : value
    ));
    const code = await runFridaBootstrapCli(forwardedArgs);
    if (code !== 0) {
      throw new Error(`CLI check failed (${commandLabel}): exit=${code}`);
    }
    return;
  }

  if (args.length === 1 && args[0] === 'gen') {
    await runFridaGeneration({ rootDir, contractPath: APP_CONTRACT_INBOX_INDEX_REL_PATH });
    return;
  }

  if (args.length >= 2 && args[0] === 'check' && args[1] === 'zone') {
    const pathIndex = args.indexOf('--path');
    const workingPath = pathIndex >= 0 && args[pathIndex + 1] ? args[pathIndex + 1] : '.';
    await runZoneCheck(rootDir, workingPath);
    return;
  }

  if (args.length === 2 && args[0] === 'check' && args[1] === 'contract-set') {
    const code = runFridaAgentsContractSetCheck({ rootDir });
    if (code !== 0) {
      throw new Error(`CLI check failed (${commandLabel}): exit=${code}`);
    }
    return;
  }

  throw new Error(`Unsupported zero-start CLI check: ${commandLabel}`);
}

async function runInterfaceInstructionCheck(rootDir: string): Promise<void> {
  const scriptUrl = pathToFileURL(
    path.join(PACKAGE_ROOT, 'templates', 'tooling', 'verify', 'check-interface-instruction-surfaces.mjs')
  ).href;
  const module = await import(scriptUrl);
  module.checkInterfaceInstructionSurfaces({ root: rootDir, mode: 'deployed' });
}

function assertToolchainUpgradeSurfaces(rootDir: string): void {
  const routerPath = path.join(rootDir, '.frida', 'contract', 'specs', 'ROUTER.xml');
  const profilePath = path.join(rootDir, '.frida', 'contract', 'profiles', 'frida_toolchain_upgrade.xml');
  const playbookPath = path.join(rootDir, '.frida', 'contract', 'playbooks', 'AGENT-frida-toolchain-upgrade.md');

  if (!fs.existsSync(profilePath)) {
    throw new Error('zero-start did not project frida_toolchain_upgrade profile');
  }
  if (!fs.existsSync(playbookPath)) {
    throw new Error('zero-start did not seed AGENT-frida-toolchain-upgrade.md');
  }

  const routerRaw = fs.readFileSync(routerPath, 'utf-8');
  for (const token of ['FRIDA_INTERFACE_TARGET_TOOLCHAIN_UPGRADE', 'frida_toolchain_upgrade']) {
    if (!routerRaw.includes(token)) {
      throw new Error(`router is missing toolchain-upgrade token: ${token}`);
    }
  }
}

function writeSyntheticPackageLock(targetDir: string): void {
  const packageJsonPath = path.join(targetDir, 'package.json');
  const packageJson = readJsonFile<Record<string, any>>(packageJsonPath);
  const packageLockPath = path.join(targetDir, 'package-lock.json');
  const dependencyVersion = packageJson?.devDependencies?.['@sistemado/frida'] || null;

  writeJsonFile(packageLockPath, {
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: packageJson.name,
        version: packageJson.version,
        devDependencies: packageJson.devDependencies || {},
      },
    },
    dependencies: dependencyVersion
      ? {
          '@sistemado/frida': {
            version: dependencyVersion,
            dev: true,
          },
        }
      : {},
  });
}

async function assertCombinedToolchainUpgradeFlow(rootDir: string): Promise<void> {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const contractIndexPath = path.join(rootDir, '.frida', 'inbox', 'app-contract', 'contract.index.yaml');

  const packageJson = readJsonFile<Record<string, any>>(packageJsonPath);
  packageJson.devDependencies = packageJson.devDependencies || {};
  const fridaVersion = String(packageJson.devDependencies['@sistemado/frida'] || '').replace(/^\^/, '');
  packageJson.devDependencies['@sistemado/frida'] = fridaVersion || packageJson.devDependencies['@sistemado/frida'];
  writeJsonFile(packageJsonPath, packageJson);
  writeSyntheticPackageLock(rootDir);

  const contractIndex = yaml.parse(fs.readFileSync(contractIndexPath, 'utf-8')) as Record<string, any>;
  contractIndex.version = '0.1.1';
  contractIndex.date = '1970-01-02';
  fs.writeFileSync(contractIndexPath, yaml.stringify(contractIndex, { lineWidth: 120 }), 'utf-8');

  await runCliCheck(rootDir, ['migration-report']);
  await runCliCheck(rootDir, ['bootstrap', '--target', '.']);
  await runCliCheck(rootDir, ['gen']);
  await runCliCheck(rootDir, ['check', 'zone', '--path', '.']);
  await runCliCheck(rootDir, ['check', 'contract-set']);
}

async function bootstrapInto(targetDir: string): Promise<void> {
  const exitCode = await runFridaBootstrapCli(['--target', targetDir, '--mode', 'zero-start']);
  if (exitCode !== 0) {
    throw new Error(`zero-start bootstrap exited with code ${exitCode} for ${targetDir}`);
  }
}

async function assertZeroStartRedeployRejected(targetDir: string): Promise<void> {
  const exitCode = await runFridaBootstrapCli(['--target', targetDir, '--mode', 'zero-start']);
  if (exitCode === 0) {
    throw new Error(`zero-start unexpectedly succeeded on a deployed repository: ${targetDir}`);
  }
}

async function assertWarmPreservesUserOwnedInstructions(targetDir: string): Promise<void> {
  const updatePath = path.join(targetDir, '.frida', 'contract', 'playbooks', 'AGENT-app-contract-update.md');
  const toolchainUpgradePath = path.join(targetDir, '.frida', 'contract', 'playbooks', 'AGENT-frida-toolchain-upgrade.md');
  const legacyUpdatePath = path.join(targetDir, '.frida', 'contract', 'playbooks', 'AGENT-contract-update.md');
  const legacyRepairPath = path.join(targetDir, '.frida', 'contract', 'playbooks', 'AGENT-contract-repair.md');
  const sentinel = '\n<!-- USER CUSTOMIZATION SENTINEL -->\n';

  fs.appendFileSync(updatePath, sentinel, 'utf-8');
  fs.appendFileSync(toolchainUpgradePath, sentinel, 'utf-8');
  fs.writeFileSync(legacyUpdatePath, '# legacy update\n', 'utf-8');
  fs.writeFileSync(legacyRepairPath, '# legacy repair\n', 'utf-8');

  const exitCode = await runFridaBootstrapCli(['--target', targetDir, '--mode', 'warm']);
  if (exitCode !== 0) {
    throw new Error(`warm bootstrap exited with code ${exitCode} for ${targetDir}`);
  }

  const updatedRaw = fs.readFileSync(updatePath, 'utf-8');
  const upgradedRaw = fs.readFileSync(toolchainUpgradePath, 'utf-8');
  if (!updatedRaw.includes(sentinel.trim())) {
    throw new Error('warm bootstrap overwrote a user-owned interface instruction surface');
  }
  if (!upgradedRaw.includes(sentinel.trim())) {
    throw new Error('warm bootstrap overwrote a user-owned toolchain-upgrade instruction surface');
  }
  if (fs.existsSync(legacyUpdatePath) || fs.existsSync(legacyRepairPath)) {
    throw new Error('warm bootstrap did not remove legacy deployed AGENT-contract-* playbooks');
  }
}

async function assertInterfaceInstructionResetRestoresBaseline(targetDir: string): Promise<void> {
  const files = [
    'AGENT-app-contract-update.md',
    'AGENT-app-contract-repair.md',
    'AGENT-frida-toolchain-upgrade.md',
  ];

  for (const fileName of files) {
    const targetPath = path.join(targetDir, '.frida', 'contract', 'playbooks', fileName);
    fs.appendFileSync(targetPath, '\n<!-- CUSTOMIZED -->\n', 'utf-8');
  }

  const exitCode = await runFridaBootstrapCli(['--target', targetDir, '--component', 'interface-instructions-reset']);
  if (exitCode !== 0) {
    throw new Error(`interface-instructions-reset exited with code ${exitCode} for ${targetDir}`);
  }

  for (const fileName of files) {
    const targetPath = path.join(targetDir, '.frida', 'contract', 'playbooks', fileName);
    const sourcePath = path.join(PACKAGE_ROOT, 'templates', 'management', fileName);
    const targetRaw = fs.readFileSync(targetPath, 'utf-8');
    const sourceRaw = fs.readFileSync(sourcePath, 'utf-8');
    if (targetRaw !== sourceRaw) {
      throw new Error(`interface-instructions-reset did not restore packaged baseline for ${fileName}`);
    }
  }
}

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frida-zero-start-'));
  const firstDir = path.join(tempRoot, 'case-a');
  const secondDir = path.join(tempRoot, 'case-b');

  fs.mkdirSync(firstDir, { recursive: true });
  fs.mkdirSync(secondDir, { recursive: true });

  try {
    await bootstrapInto(firstDir);
    await bootstrapInto(secondDir);
    await assertZeroStartRedeployRejected(firstDir);

    assertRequiredOutputs(firstDir);
    assertRequiredOutputs(secondDir);
    assertForbiddenOutputsAbsent(firstDir);
    assertForbiddenOutputsAbsent(secondDir);
    assertBootloaderIsolation(firstDir);
    assertBootloaderIsolation(secondDir);
    assertProjectedCoreMirrorSanitized(firstDir);
    assertProjectedCoreMirrorSanitized(secondDir);
    assertProjectedCoreMirrorSelfContained(firstDir);
    assertProjectedCoreMirrorSelfContained(secondDir);
    await runInterfaceInstructionCheck(firstDir);
    await runInterfaceInstructionCheck(secondDir);
    assertToolchainUpgradeSurfaces(firstDir);
    assertToolchainUpgradeSurfaces(secondDir);

    await runCliCheck(firstDir, ['check', 'zone', '--path', '.']);
    await runCliCheck(firstDir, ['check', 'contract-set']);

    const firstSnapshot = buildSnapshot(firstDir);
    const secondSnapshot = buildSnapshot(secondDir);
    assertSnapshotsEqual(firstSnapshot, secondSnapshot);

    const digest = crypto
      .createHash('sha256')
      .update(JSON.stringify([...firstSnapshot.entries()]))
      .digest('hex');

    await assertWarmPreservesUserOwnedInstructions(firstDir);
    await assertInterfaceInstructionResetRestoresBaseline(firstDir);
    await assertCombinedToolchainUpgradeFlow(firstDir);
    await runInterfaceInstructionCheck(firstDir);

    console.log(
      `zero-start determinism OK (${firstSnapshot.size} files, digest=${digest}, temp_root=${tempRoot.replace(/\\/g, '/')})`
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
