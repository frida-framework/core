#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import {
  extractVisualSchemaOverlay,
  resolveVisualOverlayPath,
} from './lib/visual-schema-extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_CONTRACT_FILE = 'contract/contract.cbmd.yaml';

function toFsPath(relativePath) {
  return path.join(ROOT_DIR, relativePath.replace(/^\.\//, '').replace(/^\/+/, ''));
}

function getArgValue(flagName) {
  const idx = process.argv.indexOf(flagName);
  if (idx === -1 || idx + 1 >= process.argv.length) {
    return null;
  }
  return process.argv[idx + 1];
}

function parseArgs() {
  const contractArg = getArgValue('--contract');
  const outputArg = getArgValue('--out');
  const printStdout = process.argv.includes('--stdout');
  const dryRun = process.argv.includes('--dry-run');

  return {
    contractPath: contractArg || DEFAULT_CONTRACT_FILE,
    outputPath: outputArg || null,
    printStdout,
    dryRun,
  };
}

function readContract(contractFilePath) {
  if (!fs.existsSync(contractFilePath)) {
    throw new Error(`Contract artifact not found: ${contractFilePath}`);
  }
  const raw = fs.readFileSync(contractFilePath, 'utf8');
  const contract = yaml.parse(raw);
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract artifact parsed to empty or non-object value.');
  }
  return { contract, raw };
}

function assertVisualSchemaContract(contract) {
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract artifact parsed to empty or non-object value.');
  }
  if (!contract.VISUAL_SCHEMA || typeof contract.VISUAL_SCHEMA !== 'object') {
    throw new Error('contract VISUAL_SCHEMA is missing or invalid.');
  }
  if (typeof contract.VISUAL_SCHEMA.version !== 'string' || !contract.VISUAL_SCHEMA.version.trim()) {
    throw new Error('contract VISUAL_SCHEMA.version must be a non-empty string.');
  }
}

function main() {
  const args = parseArgs();
  console.error('⚠️  visual-schema-extract: VISUAL_SCHEMA deprecated. Returning empty overlay.');

  const emptyOverlay = { nodes: [], edges: [] };

  const outputArg = args.outputPath;
  if (outputArg && !args.dryRun) {
    const outputFilePath = path.isAbsolute(outputArg) ? outputArg : toFsPath(outputArg);
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    fs.writeFileSync(outputFilePath, JSON.stringify(emptyOverlay, null, 2), 'utf8');
  }

  if (args.printStdout) {
    console.log(JSON.stringify(emptyOverlay, null, 2));
  }
}

try {
  main();
} catch (error) {
  console.error(`❌ visual-schema-extract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
