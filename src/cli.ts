#!/usr/bin/env node
import { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
import { runFridaAgentsContractSetCheck } from './agents-contract-set.ts';
import { runFridaCheckCli } from './zone-check.ts';
import { runFridaHashCli } from './template-hash.ts';
import { runFridaVisualCli } from './visual.ts';
import { runFridaVisualViewerCli, runFridaVisualizerCli } from './visualizer-dispatch.ts';
import { runFridaInitCli } from './init.ts';
import { runFridaReportCli } from './report.ts';
import { runFridaBuildCli } from './build.ts';
import { runFridaBootstrapCli } from './bootstrap.ts';
import { runFridaValidateCli } from './contract-validator.ts';
import { FRIDA_CLI_NAME } from './identity.ts';
import { runFridaTaskCollisionCli, runFridaTaskSetCli } from './task-set-check.ts';

function printHelp(): void {
  console.log(`${FRIDA_CLI_NAME}

Usage:
  ${FRIDA_CLI_NAME} gen
  ${FRIDA_CLI_NAME} validate [--contract <path>]
  ${FRIDA_CLI_NAME} migration-report
  ${FRIDA_CLI_NAME} init [--contract <path>] [--dry-run]
  ${FRIDA_CLI_NAME} bootstrap --target <dir> [--mode warm|cold-engine|demo|zero-start] [--dry-run]
  ${FRIDA_CLI_NAME} bootstrap --component <name> [--target <dir>]
  ${FRIDA_CLI_NAME} visual [--check] [args...]
  ${FRIDA_CLI_NAME} visualizer                     (target-repo only — illegal in Frida repo)
  ${FRIDA_CLI_NAME} report [check|path|write] [args...]
  ${FRIDA_CLI_NAME} check contract-set [--include-frida-internal]
  ${FRIDA_CLI_NAME} check task-set [--format text|json|yaml]
  ${FRIDA_CLI_NAME} check task-collision --task <path> [--format text|json|yaml]
  ${FRIDA_CLI_NAME} check [zone args...]
  ${FRIDA_CLI_NAME} hash [--manifest <path>] [--contract <path>]
  ${FRIDA_CLI_NAME} build [--public] [--output <path>] [--contract <path>]
  ${FRIDA_CLI_NAME} help
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
    case 'validate':
      return runFridaValidateCli(args, {
        rootDir: process.cwd(),
      });
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
    case 'visualizer':
      return runFridaVisualizerCli(args);
    case 'report':
      return runFridaReportCli(args);
    case 'check':
      if (args[0] === 'contract-set') {
        return runFridaAgentsContractSetCheck({
          rootDir: process.cwd(),
          includeFridaInternal: args.includes('--include-frida-internal'),
        });
      }
      if (args[0] === 'task-set') {
        return runFridaTaskSetCli(args.slice(1), { rootDir: process.cwd() });
      }
      if (args[0] === 'task-collision') {
        return runFridaTaskCollisionCli(args.slice(1), { rootDir: process.cwd() });
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
