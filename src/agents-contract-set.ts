import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractDocument } from './contract-path.ts';

export interface AgentsContractSetCheckOptions {
  rootDir?: string;
  contractPath?: string;
  includeFridaInternal?: boolean;
}

export interface AgentsContractSetCheckResult {
  ok: boolean;
  expected: string[];
  actual: string[];
  tracked: string[];
  missing: string[];
  extra: string[];
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');
const ENGINE_TEMPLATE_AGENTS_PREFIXES = [
  'templates/tooling/',
  '.frida/templates/',
] as const;

function normalizePath(input: string): string {
  const withSlashes = String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

  return withSlashes.replace(/\/+$/, '');
}

function ensureAgentsFilePath(pathLike: string): string {
  const normalized = normalizePath(pathLike);
  if (!normalized || normalized === '.') return 'AGENTS.md';
  if (normalized === 'AGENTS.md' || normalized.endsWith('/AGENTS.md')) return normalized;
  return `${normalized}/AGENTS.md`;
}

function stripWildcards(pathLike: string): string {
  const normalized = normalizePath(pathLike);
  const wildcardIndex = normalized.search(/[*?[{]/);
  const cut = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
  return cut.replace(/\/+$/, '');
}

function resolvePathNode(contract: Record<string, any>, ref: string): any | null {
  if (typeof ref !== 'string' || !ref.startsWith('PATHS.')) return null;

  const parts = ref.split('.').slice(1);
  let cursor = contract.PATHS;

  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return cursor;
}

function resolvePathRef(contract: Record<string, any>, ref: string): string | null {
  const cursor = resolvePathNode(contract, ref);
  if (cursor === null) return null;
  if (typeof cursor === 'string' && cursor.trim()) return cursor;
  if (cursor && typeof cursor === 'object' && typeof cursor.contractical === 'string' && cursor.contractical.trim()) {
    return cursor.contractical;
  }
  return null;
}

function resolvePathLike(contract: Record<string, any>, maybeRefOrPath: unknown): string | null {
  if (typeof maybeRefOrPath !== 'string' || !maybeRefOrPath.trim()) return null;
  if (maybeRefOrPath.startsWith('PATHS.')) {
    return resolvePathRef(contract, maybeRefOrPath);
  }
  return maybeRefOrPath;
}

function isZoneDefinition(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const zoneData = value as Record<string, any>;
  return typeof zoneData.pathGlobRef === 'string' || typeof zoneData.path === 'string';
}

function isFridaInternalPath(pathLike: string): boolean {
  const normalized = normalizePath(pathLike);
  return normalized === '.frida' || normalized.startsWith('.frida/');
}

function isEngineSelfRepo(rootDir: string): boolean {
  return path.resolve(rootDir) === ENGINE_PACKAGE_ROOT;
}

function isIgnoredTrackedAgentsPath(rootDir: string, relPath: string): boolean {
  if (!isEngineSelfRepo(rootDir)) {
    return false;
  }

  const normalized = normalizePath(relPath);
  return ENGINE_TEMPLATE_AGENTS_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function getZoneBlockName(rootDir: string): 'ZONES' | 'INT_FRIDA_ZONES' {
  return isEngineSelfRepo(rootDir) ? 'INT_FRIDA_ZONES' : 'ZONES';
}

function isEngineOwnedZone(contract: Record<string, any>, zoneData: Record<string, any>): boolean {
  const zonePath =
    resolvePathLike(contract, zoneData.pathGlobRef) ||
    resolvePathLike(contract, zoneData.path) ||
    '';
  const agentsPath =
    resolvePathLike(contract, zoneData.agentsPathDirRef) ||
    resolvePathLike(contract, zoneData.agentsPath) ||
    '';

  return [zonePath, agentsPath]
    .map((value) => stripWildcards(value))
    .some((value) => isFridaInternalPath(value));
}

function getZoneEntries(
  contract: Record<string, any>,
  rootDir: string,
  options: { includeFridaInternal: boolean }
): Array<[string, Record<string, any>]> {
  const blockName = getZoneBlockName(rootDir);
  const zones = contract[blockName];
  if (!zones || typeof zones !== 'object') {
    return [];
  }

  return Object.entries(zones)
    .filter((entry): entry is [string, Record<string, any>] => isZoneDefinition(entry[1]))
    .filter(([, value]) => isEngineSelfRepo(rootDir) || options.includeFridaInternal || !isEngineOwnedZone(contract, value));
}

function resolveBootloaderPath(contract: Record<string, any>): string {
  const fridaPaths = contract.FRIDA_CONFIG?.paths || {};
  const fromRef = resolvePathLike(contract, fridaPaths.agents_bootloaderFileRef);
  if (fromRef) return fromRef;

  const fromPaths = contract.PATHS?.agents?.bootloaderFile;
  if (typeof fromPaths === 'string' && fromPaths.trim()) return fromPaths;

  return 'AGENTS.md';
}

function resolveZoneAgentsPath(contract: Record<string, any>, zoneId: string, zoneData: Record<string, any>): string {
  const byRef = resolvePathLike(contract, zoneData.agentsPathDirRef);
  if (byRef) return ensureAgentsFilePath(byRef);

  const byLegacy = resolvePathLike(contract, zoneData.agentsPath);
  if (byLegacy) return ensureAgentsFilePath(byLegacy);

  const zonePathGlob =
    resolvePathLike(contract, zoneData.pathGlobRef) ||
    resolvePathLike(contract, zoneData.path);
  if (zonePathGlob) return ensureAgentsFilePath(stripWildcards(zonePathGlob));

  throw new Error(`zone.${zoneId} has no resolvable agents path (agentsPathDirRef|agentsPath|pathGlobRef|path)`);
}

function collectExpectedAgents(
  contract: Record<string, any>,
  rootDir: string,
  options: { includeFridaInternal: boolean }
): Set<string> {
  const expected = new Set<string>();
  expected.add(ensureAgentsFilePath(resolveBootloaderPath(contract)));

  for (const [zoneId, zoneData] of getZoneEntries(contract, rootDir, options)) {
    expected.add(resolveZoneAgentsPath(contract, zoneId, zoneData || {}));
  }

  return expected;
}

function collectTrackedAgents(rootDir: string, options: { includeFridaInternal: boolean }): Set<string> {
  const filesRaw = execSync('git ls-files', { cwd: rootDir, encoding: 'utf8' });
  const tracked = filesRaw
    .split('\n')
    .map((line) => normalizePath(line))
    .filter(Boolean)
    .filter((relPath) => existsSync(path.join(rootDir, relPath)))
    .filter((relPath) => relPath === 'AGENTS.md' || relPath.endsWith('/AGENTS.md'))
    // Template-source AGENTS files are package assets, not live contract-set surfaces.
    .filter((relPath) => !isIgnoredTrackedAgentsPath(rootDir, relPath))
    .filter((relPath) => options.includeFridaInternal || !isFridaInternalPath(relPath));

  return new Set(tracked);
}

function collectExistingAgents(rootDir: string, expected: Set<string>): Set<string> {
  return new Set(
    [...expected]
      .map((relPath) => normalizePath(relPath))
      .filter(Boolean)
      .filter((relPath) => existsSync(path.join(rootDir, relPath)))
  );
}

function toSortedDiff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((item) => !b.has(item)).sort((left, right) => left.localeCompare(right));
}

export function checkAgentsContractSet(options: AgentsContractSetCheckOptions = {}): AgentsContractSetCheckResult {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const includeFridaInternal = options.includeFridaInternal === true;
  const loaded = loadContractDocument(rootDir, options.contractPath);
  const contract = loaded.parsed;
  const zoneBlockName = getZoneBlockName(rootDir);

  if (!contract[zoneBlockName] || typeof contract[zoneBlockName] !== 'object') {
    throw new Error(`${zoneBlockName} block not found in contract`);
  }

  const expectedSet = collectExpectedAgents(contract, rootDir, { includeFridaInternal });
  const actualSet = collectExistingAgents(rootDir, expectedSet);
  const trackedSet = collectTrackedAgents(rootDir, { includeFridaInternal });
  const missing = toSortedDiff(expectedSet, actualSet);
  const extra = toSortedDiff(trackedSet, expectedSet);

  return {
    ok: missing.length === 0 && extra.length === 0,
    expected: [...expectedSet].sort((left, right) => left.localeCompare(right)),
    actual: [...actualSet].sort((left, right) => left.localeCompare(right)),
    tracked: [...trackedSet].sort((left, right) => left.localeCompare(right)),
    missing,
    extra,
  };
}

export function runFridaAgentsContractSetCheck(options: AgentsContractSetCheckOptions = {}): number {
  try {
    const includeFridaInternal = options.includeFridaInternal === true;
    console.log('Checking contract AGENTS.md set...');

    const result = checkAgentsContractSet(options);
    if (!result.ok) {
      console.error('AGENTS contract-set check FAILED\n');
      console.error(`Expected contract AGENTS.md files: ${result.expected.length}`);
      console.error(`Existing contract AGENTS.md files: ${result.actual.length}`);
      console.error(`Tracked AGENTS.md files:           ${result.tracked.length}\n`);

      if (result.missing.length > 0) {
        console.error('Missing contract AGENTS.md files on disk:');
        for (const filePath of result.missing) {
          console.error(`  - ${filePath}`);
        }
        console.error('');
      }

      if (result.extra.length > 0) {
        console.error('Extra (counterfeit) tracked AGENTS.md files:');
        for (const filePath of result.extra) {
          console.error(`  - ${filePath}`);
        }
        console.error('');
      }

      console.error('Recovery:');
      if (!includeFridaInternal) {
        console.error('  1. App-level verifier excludes engine-owned .frida/** surfaces by design.');
        console.error('  2. Keep app-owned AGENTS.md only at root bootloader + app contract zones.');
      } else {
        console.error('  1. Keep AGENTS.md only at contract paths from the repository-scoped zone block + root bootloader.');
      }
      console.error('  3. Regenerate artifacts: npm run frida:gen');
      return 1;
    }

    console.log(`AGENTS contract-set OK (${result.actual.length} contract file(s) present; ${result.tracked.length} tracked file(s))`);
    return 0;
  } catch (error) {
    console.error(`AGENTS contract-set check error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
