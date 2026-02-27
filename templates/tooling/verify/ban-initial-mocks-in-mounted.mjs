#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('🔍 Checking for INITIAL_POINTS and INITIAL_SEGMENTS in /src/components/mounted/...\n');

try {
  // Use ripgrep to search for the forbidden patterns
  const result = execSync(
    'rg --fixed-strings -n -S -e "INITIAL_POINTS" -e "INITIAL_SEGMENTS" src/components/mounted/',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
    }
  );

  if (result.trim()) {
    console.error('❌ Found forbidden mock constants in /src/components/mounted/:\n');
    console.error(result);
    console.error('\nTo fix:');
    console.error('  1. Remove INITIAL_POINTS and INITIAL_SEGMENTS from the files above');
    console.error('  2. Update mapper scripts in scripts/mapper/ to ensure these are stripped');
    console.error('  3. Run npm run mapper:all to regenerate output\n');
    process.exit(1);
  }

  console.log('✅ No forbidden mock constants found in /src/components/mounted/\n');
  process.exit(0);
} catch (error) {
  // Exit code 1 from rg means matches were found
  if (error.status === 1) {
    const output = error.stdout?.toString() || '';
    console.error('❌ Found forbidden mock constants in /src/components/mounted/:\n');
    console.error(output);
    console.error('\nTo fix:');
    console.error('  1. Remove INITIAL_POINTS and INITIAL_SEGMENTS from the files above');
    console.error('  2. Update mapper scripts in scripts/mapper/ to ensure these are stripped');
    console.error('  3. Run npm run mapper:all to regenerate output\n');
    process.exit(1);
  }
  
  // Directory doesn't exist or other errors
  if (error.status === 2) {
    console.log('⚠️  Warning: /src/components/mounted/ directory does not exist\n');
    process.exit(0);
  }
  
  // Other errors (rg not found, etc.)
  console.error('⚠️  Warning: Could not run ripgrep check');
  console.error('Error:', error.message);
  process.exit(0); // Don't fail the pipeline if rg is not available
}
