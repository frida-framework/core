#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  extractVisualSchemaOverlay,
  loadEffectiveVisualContractDocument,
  resolveVisualOverlayPath,
} from './lib/visual-schema-extractor.mjs';

const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
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
  const defaultContractPath = fs.existsSync(toFsPath('.frida/inbox/app-contract/contract.index.yaml'))
    ? '.frida/inbox/app-contract/contract.index.yaml'
    : 'contract/contract.index.yaml';

  return {
    contractPath: contractArg || defaultContractPath,
    outputPath: outputArg || null,
    printStdout,
    dryRun,
  };
}

function readContract(contractFilePath) {
  const loaded = loadEffectiveVisualContractDocument(ROOT_DIR, contractFilePath);
  const contract = loaded?.parsed;
  if (!contract || typeof contract !== 'object') {
    throw new Error('Contract artifact parsed to empty or non-object value.');
  }
  return {
    contract,
    raw: loaded.raw,
    contractFilePath: loaded.contractPath,
    sourcePath: path.relative(ROOT_DIR, loaded.contractPath).replace(/\\/g, '/'),
  };
}

function main() {
  const args = parseArgs();
  const contractFilePath = toFsPath(args.contractPath);
  const { contract, raw, sourcePath, contractFilePath: resolvedContractPath } = readContract(contractFilePath);
  const outputRelativePath = args.outputPath || resolveVisualOverlayPath(contract);
  const overlay = extractVisualSchemaOverlay(contract, raw, {
    sourcePath,
    contractPath: resolvedContractPath,
    outputPath: outputRelativePath,
  });

  if (!args.dryRun) {
    const outputFilePath = path.isAbsolute(outputRelativePath) ? outputRelativePath : toFsPath(outputRelativePath);
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    fs.writeFileSync(outputFilePath, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
  }

  if (args.printStdout) {
    console.log(JSON.stringify(overlay, null, 2));
  }
}

try {
  main();
} catch (error) {
  console.error(`❌ visual-schema-extract failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
