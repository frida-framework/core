#!/usr/bin/env node
import { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
import { runFridaAgentsContractSetCheck } from './agents-contract-set.ts';
import { runFridaCheckCli } from './zone-check.ts';
import { runFridaHashCli } from './template-hash.ts';
import { runFridaVisualCli } from './visual.ts';
import { runFridaVisualViewerCli } from './visualizer-dispatch.ts';
import { runFridaInitCli } from './init.ts';
import { runFridaReportCli } from './report.ts';
import { runFridaBuildCli } from './build.ts';
import { runFridaBootstrapCli } from './bootstrap.ts';

function printHelp(): void {
  console.log(`frida-core

Usage:
  frida-core gen
  frida-core migration-report
  frida-core init [--contract <path>] [--dry-run]
  frida-core bootstrap --target <dir> [--mode warm|cold-engine|demo|zero-start] [--dry-run]
  frida-core bootstrap --component <name> [--target <dir>]
  frida-core visual [--check] [args...]
  frida-core visual-viewer [--overlay <path>] [--out <path>] [--title <text>]
  frida-core report [check|path|write] [args...]
  frida-core check contract-set [--include-frida-internal]
  frida-core check [zone args...]
  frida-core hash [--manifest <path>] [--contract <path>]
  frida-core build [--public] [--output <path>] [--contract <path>]
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
      });
      return 0;
    case 'migration-report':
      return runFridaMigrationReport({
        rootDir: process.cwd(),
        strictSchema: args.includes('--strict'),
      });
    case 'init':
      return runFridaInitCli(args);
    case 'bootstrap':
      return runFridaBootstrapCli(args);
    case 'visual':
    case 'visualize':
      return runFridaVisualCli(args);
    case 'visual-viewer':
    case 'viewer':
      return runFridaVisualViewerCli(args);
    case 'report':
      return runFridaReportCli(args);
    case 'check':
      if (args[0] === 'contract-set') {
        return runFridaAgentsContractSetCheck({
          rootDir: process.cwd(),
          includeFridaInternal: args.includes('--include-frida-internal'),
        });
      }
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
