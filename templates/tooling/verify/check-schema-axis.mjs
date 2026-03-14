#!/usr/bin/env node
import path from 'node:path';
import { runFridaMigrationReport } from '@sistemado/frida';

const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function main() {
  console.log('🔍 Checking schema axis (strict migration report)...');
  const exitCode = runFridaMigrationReport({
    rootDir: ROOT_DIR,
    strictSchema: true,
  });
  if (exitCode !== 0) {
    fail('Schema axis check failed.');
  }
  console.log('✅ Schema axis OK');
}

try {
  main();
} catch (error) {
  fail(`check-schema-axis failed: ${error instanceof Error ? error.message : String(error)}`);
}
