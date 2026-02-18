#!/usr/bin/env node
import { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
import { runFridaCheckCli } from './zone-check.ts';
import { runFridaHashCli } from './template-hash.ts';
import { runFridaVisualCli } from './visual.ts';
import { runFridaInitCli } from './init.ts';
import { runFridaReportCli } from './report.ts';
import { runFridaBuildCli } from './build.ts';

function printHelp(): void {
  console.log(`frida-core

Usage:
  frida-core gen [--strict-schema]
  frida-core migration-report [--strict]
  frida-core init [--canon <path>] [--dry-run]
  frida-core visualize [--check] [args...]
  frida-core report [check|path|write] [args...]
  frida-core check [zone args...]
  frida-core hash [--manifest <path>] [--canon <path>]
  frida-core build [--public] [--output <path>] [--canon <path>]
  frida-core help
`);
}

async function run(): Promise<number> {
  const [command = 'gen', ...args] = process.argv.slice(2);

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    case 'gen':
      await runFridaGeneration({
        rootDir: process.cwd(),
        strictSchema: args.includes('--strict-schema'),
      });
      return 0;
    case 'migration-report':
      return runFridaMigrationReport({
        rootDir: process.cwd(),
        strictSchema: args.includes('--strict'),
      });
    case 'init':
      return runFridaInitCli(args);
    case 'visualize':
      return runFridaVisualCli(args);
    case 'report':
      return runFridaReportCli(args);
    case 'check':
      return runFridaCheckCli(args);
    case 'hash':
      return runFridaHashCli(args);
    case 'build':
      return runFridaBuildCli(args);
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 2;
  }
}

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(2);
  });
