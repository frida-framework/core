#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadVisualizerModuleConfig } from '../lib/visualizer-module.mjs';

const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function scanDirForPatterns(dir, patterns, label) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirForPatterns(fullPath, patterns, label);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const { pattern, message } of patterns) {
        if (content.includes(pattern)) {
          fail(`${label}: ${path.relative(ROOT_DIR, fullPath)} contains illegal reference: ${message}`);
        }
      }
    }
  }
}

function main() {
  console.log('🔍 Checking visualizer legality surfaces (static checks only)...');

  // 1. No fixture overlay directory should exist
  const fixtureDir = path.join(ROOT_DIR, 'templates', 'tooling', 'verify', 'fixtures', 'visual-overlay');
  if (fs.existsSync(fixtureDir)) {
    fail('Illegal surface: templates/tooling/verify/fixtures/visual-overlay/ still exists.');
  }

  // 2. No demo overlay references in verify scripts
  const verifyDir = path.join(ROOT_DIR, 'templates', 'tooling', 'verify');
  scanDirForPatterns(verifyDir, [
    { pattern: 'demo_overlay', message: 'demo overlay reference' },
    { pattern: 'dist/reference-viewer/demo', message: 'demo reference-viewer output path' },
  ], 'verify scripts');

  // 3. No template_app_basic visualizer execution path in package.json
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const scripts = pkg.scripts || {};
    for (const [name, cmd] of Object.entries(scripts)) {
      if (typeof cmd === 'string') {
        if (cmd.includes('template_app_basic') && cmd.includes('visual')) {
          fail(`Illegal script: package.json scripts.${name} references template_app_basic for visualizer execution.`);
        }
        if (cmd.includes('dist/reference-viewer/') && !cmd.includes('check-')) {
          fail(`Illegal script: package.json scripts.${name} references legacy dist/reference-viewer/ output path.`);
        }
      }
    }
  }

  // 4. No Frida-repo-local visualizer execution surfaces in src/
  const srcDir = path.join(ROOT_DIR, 'src');
  scanDirForPatterns(srcDir, [
    { pattern: 'fixtures/visual-overlay', message: 'fixture overlay reference' },
  ], 'src');

  // 5. Visualizer module source (if enabled) must not contain fixture references
  const config = loadVisualizerModuleConfig();
  if (config.enabled && config.moduleRootAbs) {
    scanDirForPatterns(path.join(config.moduleRootAbs, 'src'), [
      { pattern: 'fixtures/visual-overlay', message: 'fixture overlay reference' },
      { pattern: 'demo_overlay', message: 'demo overlay reference' },
    ], 'visualizer module');
  }

  console.log('✅ Visualizer legality surfaces OK (no illegal execution surfaces found)');
}

try {
  main();
} catch (error) {
  fail(`check-visual-viewer-runtime failed: ${error instanceof Error ? error.message : String(error)}`);
}
