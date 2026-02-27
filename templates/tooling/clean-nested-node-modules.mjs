#!/usr/bin/env node

import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workspaceRoot = process.cwd();
const contractNodeModules = join(workspaceRoot, 'node_modules');

function findNodeModules(dir, results = []) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        results.push(fullPath);
      } else if (entry.name !== '.git') {
        findNodeModules(fullPath, results);
      }
    }
  }

  return results;
}

function isContract(path) {
  return resolve(path) === resolve(contractNodeModules);
}

function removeNested(nodeModulesPaths) {
  for (const path of nodeModulesPaths) {
    if (isContract(path)) continue;

    try {
      rmSync(path, { recursive: true, force: true });
      console.log('   removed', path);
    } catch (error) {
      console.error('   failed to remove', path, '-', error.message);
      process.exit(1);
    }
  }
}

function main() {
  console.log('🧹 Cleaning nested node_modules...');

  let nodeModules; 
  try {
    nodeModules = findNodeModules(workspaceRoot);
  } catch (error) {
    console.error('   failed to scan workspace for node_modules:', error.message);
    process.exit(1);
  }

  const nestedNodeModules = nodeModules.filter(path => !isContract(path));

  if (nestedNodeModules.length === 0) {
    console.log('✅ No nested node_modules found');
    return;
  }

  removeNested(nestedNodeModules);
  console.log('✅ Nested node_modules cleaned');
}

main();
