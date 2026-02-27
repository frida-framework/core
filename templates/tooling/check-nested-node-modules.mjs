#!/usr/bin/env node

/**
 * Guardrail script to detect and prevent nested node_modules installations.
 * This script should be run before any npm install to ensure no nested
 * node_modules exist outside the workspace root.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceRoot = process.cwd();
const contractNodeModules = join(workspaceRoot, 'node_modules');

/**
 * Recursively find all node_modules directories
 */
function findNodeModules(dir, results = []) {
  try {
    const entries = readdirSync(dir);
    
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stats = statSync(fullPath);
      
      if (stats.isDirectory()) {
        if (entry === 'node_modules') {
          results.push(fullPath);
        } else if (entry !== '.git' && entry !== 'node_modules') {
          // Recurse into subdirectories (excluding .git and node_modules)
          findNodeModules(fullPath, results);
        }
      }
    }
  } catch (err) {
    // Ignore permission errors or missing directories
  }
  
  return results;
}

/**
 * Check if a path is the contract node_modules
 */
function isContract(path) {
  return resolve(path) === resolve(contractNodeModules);
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Checking for nested node_modules...');
  
  const allNodeModules = findNodeModules(workspaceRoot);
  
  if (allNodeModules.length === 0) {
    console.log('✅ No node_modules found');
    process.exit(0);
  }
  
  const nestedNodeModules = allNodeModules.filter(path => !isContract(path));
  
  if (nestedNodeModules.length === 0) {
    console.log('✅ Only contract node_modules found at:', contractNodeModules);
    process.exit(0);
  }
  
  console.error('\n❌ ERROR: Nested node_modules detected!');
  console.error('\nContract node_modules location:');
  console.error('  ', contractNodeModules);
  console.error('\nForbidden nested node_modules:');
  nestedNodeModules.forEach(path => {
    console.error('  ', path);
  });
  
  console.error('\n📝 To fix this:');
  console.error('  1. Delete the nested node_modules directories');
  console.error('  2. Run npm install from the workspace root');
  console.error('  3. Do NOT run npm install in subdirectories');
  
  process.exit(1);
}

main();
