#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const FORBIDDEN_FILE_PREFIXES = ['core-contract/', 'core-templates/', 'core-tasks/'];
const CONTRACT_FILES_TO_SCAN = [
  'contract/contract.index.yaml',
  'contract/bootstrap-package.manifest.yaml',
  'contract/template-integrity.manifest.yaml',
];
const FORBIDDEN_CONTENT_TOKENS = [
  '_visibility: private',
  'source_playbook_ref',
  'core-templates/management/',
  'core-tasks/',
  '-src/',
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function createNestedNpmEnv(npmCacheDir) {
  const env = { ...process.env, NPM_CONFIG_CACHE: npmCacheDir };

  for (const key of Object.keys(env)) {
    if (/^npm_/i.test(key) && key !== 'NPM_CONFIG_CACHE') {
      delete env[key];
    }
  }

  return env;
}

function readTarballFileList() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frida-pack-'));
  const npmCacheDir = process.env.NPM_CONFIG_CACHE || path.join(tempDir, 'npm-cache');
  const nestedNpmEnv = createNestedNpmEnv(npmCacheDir);

  fs.mkdirSync(npmCacheDir, { recursive: true });

  try {
    const raw = (
      process.platform === 'win32'
        ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm pack --dry-run --ignore-scripts --json'], {
            cwd: ROOT_DIR,
            encoding: 'utf8',
            env: nestedNpmEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
            cwd: ROOT_DIR,
            encoding: 'utf8',
            env: nestedNpmEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
          })
    ).trim();
    if (!raw) {
      fail('npm pack --dry-run --ignore-scripts --json produced empty output');
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.[0]?.files) ? parsed[0].files.map((entry) => entry.path) : [];
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const packedFiles = readTarballFileList();

for (const filePath of packedFiles) {
  if (FORBIDDEN_FILE_PREFIXES.some((prefix) => filePath.startsWith(prefix))) {
    fail(`publish tarball contains forbidden private surface: ${filePath}`);
  }
}

for (const filePath of CONTRACT_FILES_TO_SCAN.filter((candidate) => packedFiles.includes(candidate))) {
  const absolutePath = path.join(ROOT_DIR, filePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    continue;
  }
  const raw = fs.readFileSync(absolutePath, 'utf8');
  for (const token of FORBIDDEN_CONTENT_TOKENS) {
    if (raw.includes(token)) {
      fail(`publish tarball file ${filePath} contains forbidden token: ${token}`);
    }
  }
}

console.log('✅ Publish tarball surface is clean');
