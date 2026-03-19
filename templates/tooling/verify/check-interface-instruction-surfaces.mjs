#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { resolveSourceContractLayerRel } from '../lib/source-contract-paths.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..');

function readArgs(argv) {
  const out = { root: PACKAGE_ROOT, mode: 'source' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      out.root = path.resolve(argv[++i]);
      continue;
    }
    if (arg === '--mode' && argv[i + 1]) {
      out.mode = argv[++i];
    }
  }
  return out;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf-8');
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
  }
  return out;
}

function extractMetadataYamlBlocks(raw) {
  const blocks = [];

  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---', 4);
    if (end !== -1) {
      blocks.push(raw.slice(4, end));
    }
  }

  const fenced = raw.matchAll(/```yaml\s*([\s\S]*?)```/g);
  for (const match of fenced) {
    blocks.push(match[1]);
  }

  return blocks;
}

function collectInterfaceRefsFromObject(value, refs = new Set()) {
  if (!value || typeof value !== 'object') {
    return refs;
  }

  if (typeof value.interface_ref === 'string') {
    refs.add(value.interface_ref);
  }
  if (Array.isArray(value.interface_refs)) {
    for (const ref of value.interface_refs) {
      if (typeof ref === 'string') {
        refs.add(ref);
      }
    }
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      collectInterfaceRefsFromObject(child, refs);
    }
  }

  return refs;
}

function extractInterfaceRefs(raw) {
  const refs = new Set();

  for (const block of extractMetadataYamlBlocks(raw)) {
    try {
      const parsed = yaml.parse(block);
      collectInterfaceRefsFromObject(parsed, refs);
    } catch {
      // ignore malformed user-owned metadata and fall back to regex checks
    }
  }

  for (const match of raw.matchAll(/FRIDA_INTERFACE_[A-Z0-9_]+/g)) {
    refs.add(match[0]);
  }

  return refs;
}

function buildRequirements(mode) {
  const management = yaml.parse(readText(path.join(PACKAGE_ROOT, resolveSourceContractLayerRel('FL11-management.yaml', PACKAGE_ROOT))));
  const interfaces = [
    'FRIDA_INTERFACE_UPDATE_APP_BY_SPEC',
    'FRIDA_INTERFACE_UPDATE_APP_BY_CODE',
    'FRIDA_INTERFACE_TASK_INTAKE',
    'FRIDA_INTERFACE_TASK_SETTER',
    'FRIDA_INTERFACE_TASK_VALIDATION',
    'FRIDA_INTERFACE_TASK_TRACKING',
  ];
  const perFile = new Map();

  for (const interfaceName of interfaces) {
    const block = management?.[interfaceName];
    const instructionContract = block?.instruction_contract;
    if (!instructionContract || !instructionContract.instruction_surfaces) {
      throw new Error(`${interfaceName} is missing instruction_contract.instruction_surfaces`);
    }

    for (const surface of Object.values(instructionContract.instruction_surfaces)) {
      const currentPath =
        mode === 'deployed'
          ? surface.deployed_playbook_ref
          : surface.source_playbook_ref;
      if (typeof currentPath !== 'string' || currentPath.trim().length === 0) {
        throw new Error(`${interfaceName} has no ${mode} playbook ref`);
      }

      const entry = perFile.get(currentPath) || {
        interfaceRefs: new Set(),
        requiredTokens: new Set(),
        forbiddenTokens: new Set(),
      };

      entry.interfaceRefs.add(interfaceName);
      for (const token of collectStrings(instructionContract.required_concepts)) entry.requiredTokens.add(token);
      for (const token of collectStrings(instructionContract.required_rules_refs)) entry.requiredTokens.add(token);
      for (const token of collectStrings(instructionContract.required_invariants)) entry.requiredTokens.add(token);
      for (const token of collectStrings(instructionContract.required_guard_refs)) entry.requiredTokens.add(token);
      for (const token of collectStrings(instructionContract.required_verification)) entry.requiredTokens.add(token);
      for (const token of collectStrings(instructionContract.required_report_fields)) entry.requiredTokens.add(token);
      for (const token of collectStrings(instructionContract.forbidden_claims)) entry.forbiddenTokens.add(token);

      perFile.set(currentPath, entry);
    }
  }

  return perFile;
}

function main() {
  const { root, mode } = readArgs(process.argv);
  if (mode !== 'source' && mode !== 'deployed') {
    throw new Error(`Unsupported --mode value: ${mode}`);
  }

  const failures = [];
  const requirements = buildRequirements(mode);

  for (const [relativePath, requirement] of requirements.entries()) {
    const absolutePath = path.join(root, relativePath);
    if (!fs.existsSync(absolutePath)) {
      failures.push(`${relativePath}: missing required interface instruction surface`);
      continue;
    }

    const raw = readText(absolutePath);
    const refs = extractInterfaceRefs(raw);

    for (const interfaceRef of requirement.interfaceRefs) {
      if (!refs.has(interfaceRef)) {
        failures.push(`${relativePath}: missing explicit interface ref ${interfaceRef}`);
      }
    }

    for (const token of requirement.requiredTokens) {
      if (!raw.includes(token)) {
        failures.push(`${relativePath}: missing required normative token ${token}`);
      }
    }

    for (const token of requirement.forbiddenTokens) {
      if (raw.includes(token)) {
        failures.push(`${relativePath}: contains forbidden claim ${token}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('❌ Interface instruction surface check failed:');
    for (const failure of failures) {
      console.error(`   - ${failure}`);
    }
    process.exit(1);
  }

  console.log(`✅ Interface instruction surfaces check passed (${mode}, root=${root.replace(/\\/g, '/')})`);
}

main();
