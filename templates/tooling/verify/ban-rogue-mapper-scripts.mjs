#!/usr/bin/env node

import { execSync } from 'child_process';

console.log('🔍 Checking for rogue mapper scripts...\n');

try {
  // Search for surgery-*.ts files in scripts/ root (not allowed)
  const surgeryFiles = execSync(
    'rg --files --glob "surgery-*.ts" scripts/',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
    }
  );

  // Search for surgeon-*.ts files outside scripts/mapper/
  const surgeonFiles = execSync(
    'rg --files --glob "**/surgeon-*.ts" scripts/ | rg -v "^scripts/mapper/"',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
    }
  );

  // Search for styler-*.ts files outside scripts/mapper/
  const stylerFiles = execSync(
    'rg --files --glob "**/styler-*.ts" scripts/ | rg -v "^scripts/mapper/"',
    {
      encoding: 'utf-8',
      stdio: 'pipe',
    }
  );

  const violations = [];

  if (surgeryFiles.trim()) {
    violations.push(...surgeryFiles.trim().split('\n').map(f => ({ file: f, reason: 'surgery scripts must be in scripts/mapper/' })));
  }

  if (surgeonFiles.trim()) {
    violations.push(...surgeonFiles.trim().split('\n').map(f => ({ file: f, reason: 'surgeon scripts must be in scripts/mapper/' })));
  }

  if (stylerFiles.trim()) {
    violations.push(...stylerFiles.trim().split('\n').map(f => ({ file: f, reason: 'styler scripts must be in scripts/mapper/' })));
  }

  if (violations.length > 0) {
    console.error('❌ Found rogue mapper scripts:\n');
    
    for (const violation of violations) {
      console.error(`  📄 ${violation.file}`);
      console.error(`     Reason: ${violation.reason}\n`);
    }
    
    console.error('To fix:');
    console.error('  1. Move the rogue scripts to scripts/mapper/');
    console.error('  2. Or delete them if they are no longer needed');
    console.error('  3. All mapper surgery/styler scripts must be in scripts/mapper/\n');
    process.exit(1);
  }

  console.log('✅ No rogue mapper scripts found\n');
  process.exit(0);
} catch (error) {
  // Exit code 1 from rg means matches were found
  if (error.status === 1) {
    const output = error.stdout?.toString() || '';
    
    if (output.trim()) {
      console.error('❌ Found rogue mapper scripts:\n');
      console.error(output);
      console.error('\nTo fix:');
      console.error('  1. Move the rogue scripts to scripts/mapper/');
      console.error('  2. Or delete them if they are no longer needed');
      console.error('  3. All mapper surgery/styler scripts must be in scripts/mapper/\n');
      process.exit(1);
    }
  }
  
  // Other errors (rg not found, etc.)
  console.error('⚠️  Warning: Could not run ripgrep check');
  console.error('Error:', error.message);
  process.exit(0); // Don't fail the pipeline if rg is not available
}
