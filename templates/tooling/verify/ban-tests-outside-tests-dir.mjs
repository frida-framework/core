#!/usr/bin/env node
/**
 * Ban test files outside tests/ directory.
 * Enforces the convention: all *.test.* and *.spec.* files must live under tests/.
 */

import { execSync } from 'node:child_process';

const EXTENSIONS = ['test.ts', 'test.tsx', 'test.js', 'test.jsx', 'test.mjs', 'test.cjs',
    'spec.ts', 'spec.tsx', 'spec.js', 'spec.jsx', 'spec.mjs', 'spec.cjs'];

const GLOBS = EXTENSIONS.map(ext => `**/*.${ext}`);

// Use git ls-files to find tracked test files, then filter out those under tests/
const allFiles = execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n');

const violations = allFiles.filter(f => {
    const isTestFile = EXTENSIONS.some(ext => f.endsWith(`.${ext}`));
    if (!isTestFile) return false;
    // Allow files under tests/
    if (f.startsWith('tests/')) return false;
    // Allow tsconfig.test.json (not actually a test file, just matches loosely)
    if (f === 'tsconfig.test.json') return false;
    return true;
});

if (violations.length > 0) {
    console.error('❌ Test files found outside tests/ directory:');
    for (const v of violations) {
        console.error(`   ${v}`);
    }
    console.error('\nAll test files (*.test.*, *.spec.*) must be placed under tests/.');
    console.error('Move them to the appropriate subdirectory: tests/unit/, tests/edge/, tests/integration/, etc.');
    process.exit(1);
} else {
    console.log('✅ All test files are inside tests/');
}
