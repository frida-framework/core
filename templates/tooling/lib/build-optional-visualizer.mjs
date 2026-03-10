#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT, loadVisualizerModuleConfig } from './visualizer-module.mjs';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function main() {
  const config = loadVisualizerModuleConfig();
  if (!config.enabled) {
    console.log('ℹ️ Optional visualizer module disabled; skipping build.');
    return;
  }
  if (!config.moduleRootAbs || !fs.existsSync(config.moduleRootAbs)) {
    fail(`Visualizer module root is enabled in contract but missing on disk: ${config.moduleRootDir || '<unset>'}`);
  }

  const tsconfigPath = path.join(config.moduleRootAbs, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    fail(`Visualizer module tsconfig is missing: ${path.relative(PACKAGE_ROOT, tsconfigPath)}`);
  }

  const tscBin = path.join(PACKAGE_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tscBin)) {
    fail(`TypeScript compiler not found: ${path.relative(PACKAGE_ROOT, tscBin)}. Run npm install first.`);
  }

  const result = spawnSync(process.execPath, [tscBin, '-p', tsconfigPath], {
    cwd: PACKAGE_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  console.log(`✅ Optional visualizer module built: ${config.moduleRootDir}`);
}

try {
  main();
} catch (error) {
  fail(`build-optional-visualizer failed: ${error instanceof Error ? error.message : String(error)}`);
}
