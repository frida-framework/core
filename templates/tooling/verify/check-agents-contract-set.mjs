#!/usr/bin/env node
/**
 * Enforce contract AGENTS.md set.
 *
 * Policy:
 * - Contract set = root bootloader + one zone AGENTS.md per repository-scoped zone block.
 * - Every expected contract AGENTS.md path must exist on disk.
 * - Extra tracked AGENTS.md files outside the contract set fail verification.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModularContract } from '../lib/load-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '../../..');

const IGNORED_AGENTS_PREFIXES = [
  'templates/tooling/',
  '.frida/templates/',
];

function normalizePath(input) {
  const withSlashes = String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  return withSlashes.replace(/\/+$/, '');
}

function ensureAgentsFilePath(pathLike) {
  const normalized = normalizePath(pathLike);
  if (!normalized || normalized === '.') return 'AGENTS.md';
  if (normalized === 'AGENTS.md' || normalized.endsWith('/AGENTS.md')) return normalized;
  return `${normalized}/AGENTS.md`;
}

function resolvePathRef(contract, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('PATHS.')) return null;
  const parts = ref.split('.').slice(1);
  let cursor = contract.PATHS;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }
  return typeof cursor === 'string' ? cursor : null;
}

function resolvePathLike(contract, maybeRefOrPath) {
  if (typeof maybeRefOrPath !== 'string' || !maybeRefOrPath.trim()) return null;
  if (maybeRefOrPath.startsWith('PATHS.')) {
    return resolvePathRef(contract, maybeRefOrPath);
  }
  return maybeRefOrPath;
}

function stripWildcards(pathLike) {
  const normalized = normalizePath(pathLike);
  const wildcardIndex = normalized.search(/[*?[{]/);
  const cut = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
  return cut.replace(/\/+$/, '');
}

function resolveBootloaderPath(contract) {
  const fridaPaths = contract.FRIDA_CONFIG?.paths || {};
  const fromRef = resolvePathLike(contract, fridaPaths.agents_bootloaderFileRef);
  if (fromRef) return fromRef;

  const fromLegacy = resolvePathLike(contract, fridaPaths.agents_bootloader);
  if (fromLegacy) return fromLegacy;

  const fromPaths = contract.PATHS?.agents?.bootloaderFile;
  if (typeof fromPaths === 'string' && fromPaths.trim()) return fromPaths;

  return 'AGENTS.md';
}

function resolveZoneAgentsPath(contract, zoneId, zoneData) {
  const byRef = resolvePathLike(contract, zoneData.agentsPathDirRef);
  if (byRef) return ensureAgentsFilePath(byRef);

  const byLegacy = resolvePathLike(contract, zoneData.agentsPath);
  if (byLegacy) return ensureAgentsFilePath(byLegacy);

  const zonePathGlob = resolvePathLike(contract, zoneData.pathGlobRef) || resolvePathLike(contract, zoneData.path);
  if (zonePathGlob) return ensureAgentsFilePath(stripWildcards(zonePathGlob));

  throw new Error(`zone.${zoneId} has no resolvable agents path (agentsPathDirRef|agentsPath|pathGlobRef|path)`);
}

function isZoneDefinition(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (typeof value.pathGlobRef === 'string' || typeof value.path === 'string')
  );
}

function getZoneBlockName(contract) {
  return contract.INT_FRIDA_ZONES && typeof contract.INT_FRIDA_ZONES === 'object'
    ? 'INT_FRIDA_ZONES'
    : 'ZONES';
}

function getZoneEntries(contract) {
  const blockName = getZoneBlockName(contract);
  const zones = contract[blockName];
  if (!zones || typeof zones !== 'object') {
    return [];
  }

  return Object.entries(zones).filter(([, value]) => isZoneDefinition(value));
}

function loadContract() {
  const contract = loadModularContract(ROOT);
  const blockName = getZoneBlockName(contract);
  if (!contract[blockName] || typeof contract[blockName] !== 'object') {
    throw new Error(`${blockName} block not found in contract`);
  }
  return contract;
}

function collectExpectedAgents(contract) {
  const expected = new Set();
  expected.add(ensureAgentsFilePath(resolveBootloaderPath(contract)));

  for (const [zoneId, zoneData] of getZoneEntries(contract)) {
    expected.add(resolveZoneAgentsPath(contract, zoneId, zoneData || {}));
  }
  return expected;
}

function collectTrackedAgents() {
  const filesRaw = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' });
  const tracked = filesRaw
    .split('\n')
    .map(line => normalizePath(line))
    .filter(Boolean)
    .filter(relPath => existsSync(join(ROOT, relPath)));
  const agents = tracked
    .filter(path => path === 'AGENTS.md' || path.endsWith('/AGENTS.md'))
    .filter(path => !IGNORED_AGENTS_PREFIXES.some(prefix => path.startsWith(prefix)));
  return new Set(agents);
}

function collectExistingAgents(paths) {
  return new Set(
    [...paths].filter((relPath) => existsSync(join(ROOT, relPath)))
  );
}

function toSortedDiff(a, b) {
  return [...a].filter(x => !b.has(x)).sort((x, y) => x.localeCompare(y));
}

try {
  console.log('Checking contract AGENTS.md set...');

  const contract = loadContract();
  const expected = collectExpectedAgents(contract);
  const actual = collectExistingAgents(expected);
  const tracked = collectTrackedAgents();

  const missing = toSortedDiff(expected, actual);
  const extra = toSortedDiff(tracked, expected);

  if (missing.length > 0 || extra.length > 0) {
    console.error('AGENTS contract-set check FAILED\n');
    console.error(`Expected contract AGENTS.md files: ${expected.size}`);
    console.error(`Existing contract AGENTS.md files: ${actual.size}`);
    console.error(`Tracked AGENTS.md files:           ${tracked.size}\n`);

    if (missing.length > 0) {
      console.error('Missing contract AGENTS.md files on disk:');
      for (const p of missing) console.error(`  - ${p}`);
      console.error('');
    }

    if (extra.length > 0) {
      console.error('Extra (counterfeit) tracked AGENTS.md files:');
      for (const p of extra) console.error(`  - ${p}`);
      console.error('');
    }

    console.error('Recovery:');
    console.error('  1. Keep AGENTS.md only at contract paths from the repository-scoped zone block + root bootloader.');
    console.error('  2. Remove/rename counterfeit tracked AGENTS.md files or add proper zone definition.');
    console.error('  3. Regenerate artifacts: npm run frida:gen');
    process.exit(1);
  }

  console.log(`AGENTS contract-set OK (${actual.size} contract file(s) present; ${tracked.size} tracked file(s))`);
} catch (error) {
  console.error(`AGENTS contract-set check error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
