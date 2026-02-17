#!/usr/bin/env node
import { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
import { runFridaCheckCli } from './zone-check.ts';
import { runFridaHashCli } from './template-hash.ts';

function printHelp(): void {
  console.log(`frida-core

Usage:
  frida-core gen [--strict-schema]
  frida-core migration-report [--strict]
  frida-core check [zone args...]
  frida-core hash
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
    case 'check':
      return runFridaCheckCli(args);
    case 'hash':
      return runFridaHashCli();
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
