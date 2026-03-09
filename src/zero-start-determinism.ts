import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runFridaBootstrapCli } from './bootstrap.ts';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

const REQUIRED_OUTPUTS = [
  'README.md',
  'package.json',
  'AGENTS.md',
  '.frida/AGENTS.md',
  '.frida/config.yaml',
  '.frida/contract/AGENTS.md',
  '.frida/contract/app/contract.index.yaml',
  '.frida/contract/app/layers/AL01-shared.yaml',
  '.frida/contract/app/layers/AL02-agent-framework.yaml',
  '.frida/contract/app/extensions/AL11-extension_backend.yaml',
  '.frida/contract/app/extensions/AL12-extension_backend_supabase.yaml',
  '.frida/contract/artifacts/frida.ir.json',
  '.frida/contract/artifacts/frida.permissions.json',
  '.frida/contract/artifacts/frida.graph.mmd',
  '.frida/contract/docs/policy/BOUNDARIES.md',
  '.frida/contract/docs/policy/IMMUTABILITY.md',
  '.frida/contract/frida/contract.index.yaml',
  '.frida/contract/specs/ROUTER.xml',
  '.frida/contract/profiles/app_governance.xml',
  '.frida/inbox/app-contract/contract.index.yaml',
  '.frida/inbox/app-contract/layers/AL01-shared.yaml',
  '.frida/inbox/app-contract/layers/AL02-agent-framework.yaml',
  '.frida/inbox/app-contract/extensions/AL11-extension_backend.yaml',
  '.frida/inbox/app-contract/extensions/AL12-extension_backend_supabase.yaml',
  '.frida/templates/frida/bootloader.hbs',
  '.frida/templates/docs-gen/agents-mapper.hbs',
  'scripts/verify/check-agents-contract-set.mjs',
];

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

function buildSnapshot(rootDir: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const relativePath of listFiles(rootDir)) {
    snapshot.set(relativePath, hashFile(path.join(rootDir, relativePath)));
  }
  return snapshot;
}

function assertRequiredOutputs(rootDir: string): void {
  const missing = REQUIRED_OUTPUTS.filter((relativePath) => !fs.existsSync(path.join(rootDir, relativePath)));
  if (missing.length > 0) {
    throw new Error(`zero-start is missing required outputs: ${missing.join(', ')}`);
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

function runCliCheck(rootDir: string, args: string[]): void {
  const result = spawnSync(process.execPath, [path.join(PACKAGE_ROOT, 'dist', 'cli.js'), ...args], {
    cwd: rootDir,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(
      `CLI check failed (${args.join(' ')}): ${result.stderr || result.stdout || `exit=${result.status}`}`
    );
  }
}

function runGit(rootDir: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout || `exit=${result.status}`}`);
  }
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

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'frida-zero-start-'));
  const firstDir = path.join(tempRoot, 'case-a');
  const secondDir = path.join(tempRoot, 'case-b');

  fs.mkdirSync(firstDir, { recursive: true });
  fs.mkdirSync(secondDir, { recursive: true });

  try {
    runGit(firstDir, ['init', '-q']);
    runGit(secondDir, ['init', '-q']);

    await bootstrapInto(firstDir);
    await bootstrapInto(secondDir);
    await assertZeroStartRedeployRejected(firstDir);

    runGit(firstDir, ['add', '-A']);

    assertRequiredOutputs(firstDir);
    assertRequiredOutputs(secondDir);

    runCliCheck(firstDir, ['check', 'zone', '--path', '.']);
    runCliCheck(firstDir, ['check', 'contract-set']);

    const firstSnapshot = buildSnapshot(firstDir);
    const secondSnapshot = buildSnapshot(secondDir);
    assertSnapshotsEqual(firstSnapshot, secondSnapshot);

    const digest = crypto
      .createHash('sha256')
      .update(JSON.stringify([...firstSnapshot.entries()]))
      .digest('hex');

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
