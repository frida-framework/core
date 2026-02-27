#!/usr/bin/env node

/**
 * Ban legacy paths in active zones
 *
 * According to AGENTS.md:
 * - src/** must NOT import from legacy (no new imports from legacy in src/**)
 * - scripts/** CAN read from legacy/src/shared/** (tooling is allowed)
 * - tests/** must NOT import from legacy (test code should use active modules)
 *
 * This script enforces these boundaries by checking only src/** and tests/**
 * for actual import/require statements that reference legacy paths.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

// Only check src/** and tests/** for legacy imports
// scripts/** is exempt (tooling can read from legacy/src/shared)
const ACTIVE_ZONES = [
  { path: path.join(ROOT_DIR, 'src'), name: 'src' },
  { path: path.join(ROOT_DIR, 'tests'), name: 'tests' },
];

// Patterns that indicate actual imports (not just mentions in comments/config)
const LEGACY_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*\/legacy\//,
  /from\s+['"][^'"]*@legacy\//,
  /import\s+[^'"]*['"][^'"]*\/legacy\//,
  /import\s+[^'"]*['"]@legacy\//,
  /require\s*\(\s*['"][^'"]*\/legacy\//,
  /require\s*\(\s*['"][^'"]*@legacy\//,
];

const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function findFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip node_modules and .git
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        files.push(...findFiles(fullPath));
      }
    } else if (entry.isFile() && FILE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const violations = [];

  for (const pattern of LEGACY_IMPORT_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      violations.push(match[0].trim());
    }
  }

  return violations;
}

function main() {
  console.log('Checking for legacy imports in src/** and tests/**...\n');

  let totalViolations = 0;
  const violationsByFile = [];

  for (const zone of ACTIVE_ZONES) {
    const files = findFiles(zone.path);

    console.log(`Scanning ${files.length} files in ${zone.name}/...`);

    for (const file of files) {
      const violations = checkFile(file);

      if (violations.length > 0) {
        const relativePath = path.relative(ROOT_DIR, file);
        violationsByFile.push({ file: relativePath, patterns: violations });
        totalViolations += violations.length;
      }
    }
  }

  if (totalViolations > 0) {
    console.error(`\n❌ Found ${totalViolations} legacy import(s) in active zones:\n`);

    for (const { file, patterns } of violationsByFile) {
      console.error(`  📄 ${file}`);
      for (const pattern of patterns) {
        console.error(`     - Import: "${pattern}"`);
      }
    }

    console.error('\nLegacy imports are banned in src/** and tests/**');
    console.error('According to AGENTS.md: "не добавлять новые импорты из legacy в src/**"\n');
    process.exit(1);
  }

  console.log('\n✅ No legacy imports found in src/** or tests/**\n');
  process.exit(0);
}

main();
