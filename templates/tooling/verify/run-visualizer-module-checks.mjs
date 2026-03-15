#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadVisualizerModuleConfig } from '../lib/visualizer-module.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function main() {
  console.log('🔍 Checking optional visualizer module (static legality only)...');
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

  // Static legality: no fixture overlay references in visualizer module source
  const srcDir = path.join(config.moduleRootAbs, 'src');
  if (fs.existsSync(srcDir)) {
    const srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'));
    for (const file of srcFiles) {
      const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
      if (content.includes('fixtures/visual-overlay')) {
        fail(`Visualizer module source references fixture overlays: ${file}`);
      }
      if (content.includes('demo_overlay') || content.includes('demo/index.html')) {
        fail(`Visualizer module source references demo overlay surface: ${file}`);
      }
    }
  }

  // Static legality: no reference-viewer output paths remain
  const distDir = config.moduleDistAbs;
  if (distDir && fs.existsSync(distDir)) {
    const distFiles = fs.readdirSync(distDir);
    for (const file of distFiles) {
      const content = fs.readFileSync(path.join(distDir, file), 'utf8');
      if (content.includes('dist/reference-viewer/')) {
        fail(`Visualizer module dist references legacy reference-viewer output path: ${file}`);
      }
    }
  }

  console.log('✅ Optional visualizer module checks OK (static legality only)');
}

try {
  main();
} catch (error) {
  fail(`run-visualizer-module-checks failed: ${error instanceof Error ? error.message : String(error)}`);
}
