#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT_DIR = path.resolve(process.cwd());
const NODE_EXE = process.execPath;
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist', 'reference-viewer', 'verify-mounted-child');
const OUTPUT_HTML = path.join(OUTPUT_DIR, 'index.html');
const FIXTURE_OVERLAY = path.join(
  ROOT_DIR,
  'templates',
  'tooling',
  'verify',
  'fixtures',
  'visual-overlay',
  'mounted_child_boundary.overlay.json'
);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function main() {
  console.log('🔍 Checking visual reference viewer...');

  if (fs.existsSync(OUTPUT_DIR)) {
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
  }

  execFileSync(
    NODE_EXE,
    [
      'dist/cli.js',
      'visual-viewer',
      '--overlay',
      FIXTURE_OVERLAY,
      '--out',
      OUTPUT_HTML,
      '--title',
      'Mounted Child Demo',
    ],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    }
  );

  const requiredFiles = [
    OUTPUT_HTML,
    path.join(OUTPUT_DIR, 'visual-reference-viewer-app.js'),
    path.join(OUTPUT_DIR, 'visual-viewer.js'),
  ];
  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      fail(`Reference viewer output missing: ${path.relative(ROOT_DIR, filePath)}`);
    }
  }

  const html = fs.readFileSync(OUTPUT_HTML, 'utf8');
  for (const fragment of [
    'Mounted Child Demo',
    'frida-overlay-json',
    './visual-reference-viewer-app.js',
    'mounted_child_boundary.overlay.json',
  ]) {
    if (!html.includes(fragment)) {
      fail(`Reference viewer HTML is missing expected fragment: ${fragment}`);
    }
  }

  console.log('✅ Visual reference viewer OK');
}

try {
  main();
} catch (error) {
  fail(`check-visual-reference-viewer failed: ${error instanceof Error ? error.message : String(error)}`);
}
