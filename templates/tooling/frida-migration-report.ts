#!/usr/bin/env tsx
import { runFridaMigrationReport } from '@sistemado/frida';

process.exit(
  runFridaMigrationReport({
    rootDir: process.cwd(),
    strictSchema: process.argv.includes('--strict'),
  })
);
