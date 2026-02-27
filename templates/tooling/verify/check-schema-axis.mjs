#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFridaMigrationReport } from '@hanszel/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

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

