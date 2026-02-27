#!/usr/bin/env tsx
import { runFridaMigrationReport } from './frida-core-bridge.ts';

process.exit(
  runFridaMigrationReport({
    rootDir: process.cwd(),
    strictSchema: process.argv.includes('--strict'),
  })
);
