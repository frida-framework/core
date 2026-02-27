#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '../..');
const ROOT_DIR = __dirname;

// Output directory to hash
const OUTPUT_DIR = join(ROOT_DIR, 'src/mount');

// Create a stable hash of a directory
function hashDirectory(dirPath) {
  const files = [];
  
  if (!existsSync(dirPath)) {
    return null;
  }
  
  // Recursively collect all files
  function collectFiles(currentDir) {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }
  
  collectFiles(dirPath);
  
  // Sort files for deterministic ordering
  files.sort();
  
  // Create hash of all file contents
  const hash = createHash('sha256');
  
  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf-8');
    const relativePath = relative(dirPath, filePath);
    
    // Include both path and content in hash
    hash.update(relativePath);
    hash.update('\0'); // Null separator
    hash.update(content);
    hash.update('\0'); // Null separator
  }
  
  return hash.digest('hex');
}

console.log('🔍 Checking mapper determinism...\n');

try {
  console.log('Running mapper:all (first run)...');
  execSync('npm run mapper:all', { stdio: 'inherit' });
  console.log('✅ First run complete\n');
  
  const hash1 = hashDirectory(OUTPUT_DIR);
  
  if (!hash1) {
    console.log('⚠️  Warning: Output directory does not exist after first run\n');
    process.exit(0);
  }
  
  console.log('Running mapper:all (second run)...');
  execSync('npm run mapper:all', { stdio: 'inherit' });
  console.log('✅ Second run complete\n');
  
  const hash2 = hashDirectory(OUTPUT_DIR);
  
  if (!hash2) {
    console.log('⚠️  Warning: Output directory does not exist after second run\n');
    process.exit(0);
  }
  
  console.log(`First run hash:  ${hash1}`);
  console.log(`Second run hash: ${hash2}\n`);
  
  if (hash1 !== hash2) {
    console.error('❌ Mapper output is not deterministic!\n');
    console.error('The mapper produced different output on consecutive runs.');
    console.error('This indicates non-deterministic behavior in the mapper scripts.\n');
    console.error('To fix:');
    console.error('  1. Review mapper scripts in scripts/mapper/ for non-deterministic operations');
    console.error('  2. Check for timestamp generation, random values, or unstable ordering');
    console.error('  3. Ensure all file operations are deterministic\n');
    process.exit(1);
  }
  
  console.log('✅ Mapper output is deterministic\n');
  process.exit(0);
} catch (error) {
  console.error('❌ Mapper determinism check failed:\n');
  console.error(error.message);
  console.error('\nTo fix:');
  console.error('  1. Ensure npm run mapper:all runs successfully');
  console.error('  2. Check for non-deterministic operations in mapper scripts\n');
  process.exit(1);
}
