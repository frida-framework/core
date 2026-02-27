#!/usr/bin/env node

/**
 * Check that generated documentation is up-to-date
 * 
 * Verifies:
 * 1. All generated files have AUTO-GENERATED header
 * 2. Running docs:generate produces no git diff
 * 
 * Part of: npm run verify
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';

const GENERATED_FILES = [
  'docs/policy/BOUNDARIES.md',
  'docs/policy/IMMUTABILITY.md',
  'docs/reference/API_REFERENCE.md',
  'src/components/AGENTS.md',
  'scripts/mapper/AGENTS.md',
  'dist/aistudio/AGENTS.md',
  'src/services/AGENTS.md',
];

const AUTO_GENERATED_MARKER = '<!-- AUTO-GENERATED FROM CONTRACT';

// Step 1: Check for AUTO-GENERATED headers
console.log('Checking AUTO-GENERATED headers...');
let headerCheckFailed = false;

for (const filepath of GENERATED_FILES) {
  if (!existsSync(filepath)) {
    console.warn(`⚠️  Generated file not found: ${filepath}`);
    console.warn('   Run: npm run docs:generate');
    headerCheckFailed = true;
    continue;
  }

  const content = readFileSync(filepath, 'utf-8');
  if (!content.startsWith(AUTO_GENERATED_MARKER)) {
    console.error(`❌ Missing AUTO-GENERATED header: ${filepath}`);
    console.error('   This file was manually edited!');
    console.error('   Fix: Revert manual edits and update templates/contract instead');
    headerCheckFailed = true;
  }
}

if (headerCheckFailed) {
  console.error('\n❌ Generated docs check FAILED: header violations detected\n');
  process.exit(1);
}

console.log('✅ All generated files have AUTO-GENERATED headers');

// Step 2: Check if regeneration produces diff
console.log('\nChecking if docs are up-to-date...');

try {
  // Save current git state
  const beforeDiff = execSync('git diff --stat', { encoding: 'utf-8' });
  
  // Regenerate docs
  execSync('npm run docs:generate', { stdio: 'ignore' });
  
  // Check if anything changed
  const afterDiff = execSync('git diff --stat', { encoding: 'utf-8' });
  
  if (afterDiff !== beforeDiff) {
    console.error('❌ Generated docs are OUTDATED\n');
    console.error('Changes detected after regeneration:');
    console.error(execSync('git diff --stat ' + GENERATED_FILES.join(' '), { encoding: 'utf-8' }));
    console.error('\nFix:');
    console.error('  1. Run: npm run docs:generate');
    console.error('  2. Review changes: git diff');
    console.error('  3. Commit: git add . && git commit -m "docs: regenerate"');
    console.error('');
    process.exit(1);
  }
  
  console.log('✅ Generated docs are up-to-date');
  
} catch (error) {
  console.error('❌ Generated docs check failed:', error.message);
  process.exit(1);
}

console.log('\n✅ All generated docs checks passed');
