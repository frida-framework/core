#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '../..');

// Contract definition (mirrors scripts/mapper/contract.ts)
const CONTRACT = {
  paths: {
    outputs: {
      wizard: '/src/mount/wizard/',
      timeline: '/src/mount/timeline/',
    },
  },
  forbidden: {
    mockConstants: [
      'INITIAL_POINTS',
      'INITIAL_SEGMENTS',
      'const MOCK_',
      'const DEMO_',
    ],
    wizardImports: [
      "import { generateRoute } from './services/geminiService';",
    ],
    wizardState: [
      'routeData',
      'setRouteData',
    ],
    timelineImports: [
      "import { calculateSegmentDetails } from './services/geminiService';",
    ],
    timelineState: [
      'handleCalculateSegment',
      'isCalculating',
    ],
    timelineUI: [
      'Search card',
      'point controls',
      'segment controls',
      'photos',
    ],
  },
};

// Collect all forbidden patterns
const FORBIDDEN_PATTERNS = [
  ...CONTRACT.forbidden.mockConstants,
  ...CONTRACT.forbidden.wizardImports,
  ...CONTRACT.forbidden.wizardState,
  ...CONTRACT.forbidden.timelineImports,
  ...CONTRACT.forbidden.timelineState,
  ...CONTRACT.forbidden.timelineUI,
];

// Output directories to check
const OUTPUT_DIRS = [
  join(ROOT_DIR, CONTRACT.paths.outputs.wizard),
  join(ROOT_DIR, CONTRACT.paths.outputs.timeline),
];

// File extensions to check
const CHECK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

// Violation tracking
let violations = [];
let filesChecked = 0;

// Recursively find files to check
function findFiles(dir, extensions) {
  const files = [];
  
  if (!existsSync(dir)) {
    console.log(`⚠️  Directory does not exist: ${dir}`);
    return files;
  }
  
  const entries = readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    
    if (entry.isDirectory()) {
      files.push(...findFiles(fullPath, extensions));
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Check a single file for forbidden patterns
function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const relativePath = relative(ROOT_DIR, filePath);
  
  const foundPatterns = [];
  
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (content.includes(pattern)) {
      foundPatterns.push(pattern);
    }
  }
  
  if (foundPatterns.length > 0) {
    violations.push({
      file: relativePath,
      patterns: foundPatterns,
    });
  }
  
  filesChecked++;
}

// Main execution
console.log('🔍 Checking mapper contract compliance...\n');

for (const dir of OUTPUT_DIRS) {
  const files = findFiles(dir, CHECK_EXTENSIONS);
  
  console.log(`Checking ${files.length} file(s) in ${relative(ROOT_DIR, dir)}...`);
  
  for (const file of files) {
    checkFile(file);
  }
}

// Report results
console.log(`\n✓ Checked ${filesChecked} file(s)`);

if (violations.length > 0) {
  console.error(`\n❌ Found ${violations.length} violation(s):\n`);
  
  for (const violation of violations) {
    console.error(`  📄 ${violation.file}`);
    for (const pattern of violation.patterns) {
      console.error(`     - Forbidden pattern: "${pattern}"`);
    }
    console.error();
  }
  
  console.error('Mapper contract check FAILED.\n');
  console.error('To fix:');
  console.error('  1. Review the forbidden patterns above');
  console.error('  2. Update mapper scripts in scripts/mapper/ to remove these patterns');
  console.error('  3. Run npm run mapper:all to regenerate output');
  console.error('  4. Re-run npm run verify\n');
  
  process.exit(1);
} else {
  console.log('✅ Mapper contract check PASSED.\n');
  process.exit(0);
}
