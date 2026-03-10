#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVisualizerModuleConfig } from '../lib/visualizer-module.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.cwd());
const NODE_EXE = process.execPath;
const CHECKS = [
  path.join(__dirname, 'check-visual-viewer-runtime.mjs'),
  path.join(__dirname, 'check-visual-reference-viewer.mjs'),
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function main() {
  console.log('🔍 Checking optional visualizer module...');
  const config = loadVisualizerModuleConfig();

  if (!config.enabled) {
    console.log('ℹ️ Optional visualizer module disabled; skipping module checks.');
    return;
  }

  if (!config.moduleRootAbs || !fs.existsSync(config.moduleRootAbs)) {
    fail(
      `Visualizer module is enabled in contract but missing on disk: ${config.moduleRootDir || '<unset>'}`
    );
  }

  for (const scriptPath of CHECKS) {
    execFileSync(NODE_EXE, [scriptPath], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  }

  console.log('✅ Optional visualizer module checks OK');
}

try {
  main();
} catch (error) {
  fail(`run-visualizer-module-checks failed: ${error instanceof Error ? error.message : String(error)}`);
}
