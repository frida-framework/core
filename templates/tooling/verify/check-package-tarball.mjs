#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const WIN32_SHELL = process.env.ComSpec || 'cmd.exe';
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

function readTarballFileList() {
  const command = process.platform === 'win32'
    ? {
        file: WIN32_SHELL,
        args: ['/d', '/s', '/c', 'npm pack --dry-run --ignore-scripts --json'],
      }
    : {
        file: 'npm',
        args: ['pack', '--dry-run', '--ignore-scripts', '--json'],
      };

  const raw = execFileSync(command.file, command.args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.[0]?.files) ? parsed[0].files.map((entry) => entry.path) : [];
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
