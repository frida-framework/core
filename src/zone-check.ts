/**
 * FRIDA Check CLI v1.0
 * 
 * Single source of truth for zone resolution and AGENTS.md validation.
 * Implements contractical algorithm from contract:FRIDA_LIFECYCLE.3_VALIDATE_ANTIPATTERN
 * 
 * Usage:
 *   frida-check zone --path <working_dir> [--format yaml|json|text] [--trace]
 * 
 * Exit codes:
 *   0 - Success: contractical AGENTS.md exists
 *   1 - Error: zone resolved but AGENTS.md missing
 *   2 - Error: zone could not be resolved
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { fileURLToPath } from 'url';
import { loadContractDocument } from './contract-path.ts';

// === CONFIG ===
const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

// === TYPES ===
export interface Zone {
    id: string;
    path: string;
    agentsPath?: string;
    excludePathPrefixes?: string[];
    readOnly?: boolean;
    purpose?: string;
}

export interface ZoneCandidate {
    zone_id: string;
    path: string;
    specificity: number;
}

export interface DecisionStep {
    step: string;
    input?: string;
    candidates?: ZoneCandidate[];
    selected?: string;
    reason?: string;
    expected?: string;
    exists?: boolean;
}

export interface ValidationResult {
    zone_id: string | null;
    zone_path: string | null;
    agents_path: string | null;
    expected_agents_md: string | null;
    exists: boolean;
    decision_trace: DecisionStep[];
    error?: string;
}

function isEngineSelfRepo(rootDir: string): boolean {
    return path.resolve(rootDir) === ENGINE_PACKAGE_ROOT;
}

function getZoneBlockName(contractRoot: string): 'ZONES' | 'INT_FRIDA_ZONES' {
    return isEngineSelfRepo(contractRoot) ? 'INT_FRIDA_ZONES' : 'ZONES';
}

function resolvePathRef(contract: Record<string, any>, ref: string): string | null {
    if (typeof ref !== 'string' || !ref.startsWith('PATHS.')) {
        return null;
    }

    const parts = ref.split('.').slice(1);
    let cursor: any = contract.PATHS;
    for (const part of parts) {
        if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
            return null;
        }
        cursor = cursor[part];
    }

    if (typeof cursor === 'string') {
        return cursor;
    }
    if (cursor && typeof cursor === 'object' && typeof cursor.contractical === 'string') {
        return cursor.contractical;
    }

    return null;
}

function resolvePathLike(contract: Record<string, any>, value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    if (value.startsWith('PATHS.')) {
        return resolvePathRef(contract, value);
    }
    return value;
}

function isZoneDefinition(value: unknown): value is Record<string, any> {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const zoneData = value as Record<string, any>;
    return typeof zoneData.pathGlobRef === 'string' || typeof zoneData.path === 'string';
}

function getZoneEntries(contract: Record<string, any>): Array<[string, Record<string, any>]> {
    const blockName = getZoneBlockName(ROOT_DIR);
    const zones = contract[blockName];
    if (!zones || typeof zones !== 'object') {
        return [];
    }

    return Object.entries(zones)
        .filter(([, value]) => isZoneDefinition(value)) as Array<[string, Record<string, any>]>;
}

// === CONTRACT LOADER ===
export function loadZones(contractPath?: string): Map<string, Zone> {
    const loaded = loadContractDocument(ROOT_DIR, contractPath);
    const contract = loaded.parsed;
    const zones = new Map<string, Zone>();

    const zoneBlockName = getZoneBlockName(ROOT_DIR);
    if (!contract[zoneBlockName]) {
        throw new Error(`${zoneBlockName} block not found in contract`);
    }

    for (const [id, data] of getZoneEntries(contract)) {
        const zoneData = data as any;
        const zonePath =
            resolvePathLike(contract, zoneData.pathGlobRef) ||
            resolvePathLike(contract, zoneData.path);
        if (!zonePath) {
            throw new Error(`${zoneBlockName}.${id}.path is missing or unresolved (pathGlobRef|path expected)`);
        }

        const zoneAgentsPath =
            resolvePathLike(contract, zoneData.agentsPathDirRef) ||
            resolvePathLike(contract, zoneData.agentsPath) ||
            undefined;

        zones.set(id, {
            id,
            path: zonePath,
            agentsPath: zoneAgentsPath,
            excludePathPrefixes: Array.isArray(zoneData.exclude_path_prefixes)
                ? zoneData.exclude_path_prefixes.filter((item: unknown) => typeof item === 'string')
                : undefined,
            readOnly: zoneData.readOnly,
            purpose: zoneData.purpose,
        });
    }

    return zones;
}

// === ZONE RESOLVER ===
/**
 * Calculate path specificity (depth) for matching.
 * More segments = more specific.
 */
function calculateSpecificity(pattern: string): number {
    // Remove glob suffix and count segments
    const normalized = pattern.replace(/\/?\*\*?\/?$/, '');
    return normalized.split('/').filter(s => s.length > 0).length;
}

/**
 * Check if a working directory matches a zone path pattern.
 * Pattern is a glob like "service/functions/**" or "src/services/**"
 */
function matchesZonePath(workingDir: string, zonePattern: string): boolean {
    // Normalize paths
    const normalizedWorkDir = workingDir.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');
    const normalizedPattern = zonePattern.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');

    // Extract prefix from pattern (remove glob suffix)
    const prefix = normalizedPattern.replace(/\/?\*\*?\/?$/, '').replace(/\/$/, '');

    // Global wildcard zone (for example "**") should match any normalized path.
    if (!prefix) {
        return true;
    }

    // Check if working dir starts with prefix or equals prefix
    if (normalizedWorkDir === prefix) {
        return true;
    }

    if (normalizedWorkDir.startsWith(prefix + '/')) {
        return true;
    }

    // Also check if prefix starts with working dir (e.g., workDir="src", pattern="src/services/**")
    // This means the working dir is a parent of the zone - should NOT match
    // Zone resolution is for finding which zone CONTAINS the working dir

    return false;
}

/**
 * Resolve zone for a given working directory.
 * Uses "most specific matching path" algorithm from contract.
 * 
 * IMPORTANT: Zone MUST NOT be inferred from profile allowlists, scope, or working_dir guess.
 * Zone is resolved ONLY by matching path against the repository-scoped zone block.
 */
export function resolveZone(workingDir: string, zones: Map<string, Zone>): { zone: Zone | null; trace: DecisionStep } {
    const candidates: ZoneCandidate[] = [];
    const normalizedWorkingDir = workingDir.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');

    for (const [id, zone] of zones) {
        const excludedByPrefix = Array.isArray(zone.excludePathPrefixes) && zone.excludePathPrefixes.some((prefix) => {
            const normalizedPrefix = String(prefix || '')
                .replace(/\\/g, '/')
                .replace(/^\//, '')
                .replace(/\/$/, '');
            if (!normalizedPrefix.length) {
                return false;
            }
            return normalizedWorkingDir === normalizedPrefix || normalizedWorkingDir.startsWith(`${normalizedPrefix}/`);
        });
        if (excludedByPrefix) {
            continue;
        }

        if (matchesZonePath(workingDir, zone.path)) {
            candidates.push({
                zone_id: id,
                path: zone.path,
                specificity: calculateSpecificity(zone.path),
            });
        }
    }

    // Sort by specificity descending (most specific first)
    // Tie-break: lexicographic order by zone_id for determinism
    candidates.sort((a, b) => {
        if (b.specificity !== a.specificity) {
            return b.specificity - a.specificity;
        }
        return a.zone_id.localeCompare(b.zone_id);
    });

    const trace: DecisionStep = {
        step: 'RESOLVE_ZONE',
        input: workingDir,
        candidates,
    };

    if (candidates.length === 0) {
        trace.selected = undefined;
        trace.reason = 'no matching zone found';
        return { zone: null, trace };
    }

    const selected = candidates[0];
    trace.selected = selected.zone_id;
    trace.reason = candidates.length > 1
        ? `most specific match (depth ${selected.specificity}, ${candidates.length} candidates)`
        : `single match (depth ${selected.specificity})`;

    return { zone: zones.get(selected.zone_id) || null, trace };
}

/**
 * Get expected AGENTS.md path for a zone.
 */
export function getExpectedAgentsMd(zone: Zone): string {
    if (!zone.agentsPath) {
        // Fallback: derive from zone path
        const basePath = zone.path.replace(/\/?\*\*?\/?$/, '');
        return `${basePath}/AGENTS.md`;
    }
    if (zone.agentsPath === '.') {
        return 'AGENTS.md';
    }
    return `${zone.agentsPath.replace(/\/$/, '')}/AGENTS.md`;
}

/**
 * Validate that contractical AGENTS.md exists for the zone containing working_dir.
 */
export function validateZoneAgentsMd(workingDir: string, contractPath?: string): ValidationResult {
    const trace: DecisionStep[] = [];

    // Load zones from contract
    let zones: Map<string, Zone>;
    try {
        zones = loadZones(contractPath);
    } catch (err) {
        return {
            zone_id: null,
            zone_path: null,
            agents_path: null,
            expected_agents_md: null,
            exists: false,
            decision_trace: trace,
            error: `Failed to load contract: ${err}`,
        };
    }

    // Resolve zone
    const { zone, trace: resolveTrace } = resolveZone(workingDir, zones);
    trace.push(resolveTrace);

    if (!zone) {
        return {
            zone_id: null,
            zone_path: null,
            agents_path: null,
            expected_agents_md: null,
            exists: false,
            decision_trace: trace,
            error: `No zone matches path: ${workingDir}`,
        };
    }

    // Get expected AGENTS.md path
    const expectedAgentsMd = getExpectedAgentsMd(zone);
    const absolutePath = path.join(ROOT_DIR, expectedAgentsMd);
    const exists = fs.existsSync(absolutePath);

    trace.push({
        step: 'LOCATE_AGENTS_MD',
        expected: expectedAgentsMd,
        exists,
    });

    return {
        zone_id: zone.id,
        zone_path: zone.path,
        agents_path: zone.agentsPath || null,
        expected_agents_md: expectedAgentsMd,
        exists,
        decision_trace: trace,
        error: exists ? undefined : `Contractical AGENTS.md missing: ${expectedAgentsMd}`,
    };
}

// === CLI ===
interface CliArgs {
    command: string;
    path: string;
    contractPath: string | null;
    format: 'yaml' | 'json' | 'text';
    trace: boolean;
}

function parseArgs(args: string[]): CliArgs {
    const result: CliArgs = {
        command: 'zone',
        path: '',
        contractPath: null,
        format: 'text',
        trace: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') {
            continue;
        }

        if (arg === 'zone') {
            result.command = 'zone';
        } else if (arg === '--contract' && i + 1 < args.length) {
            result.contractPath = args[++i];
        } else if (arg === '--path' && i + 1 < args.length) {
            result.path = args[++i];
        } else if (arg === '--format' && i + 1 < args.length) {
            const fmt = args[++i];
            if (fmt === 'yaml' || fmt === 'json' || fmt === 'text') {
                result.format = fmt;
            }
        } else if (arg === '--trace') {
            result.trace = true;
        }
    }

    return result;
}

function formatOutput(result: ValidationResult, format: 'yaml' | 'json' | 'text', showTrace: boolean): string {
    const output: any = {
        zone_id: result.zone_id,
        zone_path: result.zone_path,
        agents_path: result.agents_path,
        expected_agents_md: result.expected_agents_md,
        exists: result.exists,
    };

    if (result.error) {
        output.error = result.error;
    }

    if (showTrace) {
        output.decision_trace = result.decision_trace;
    }

    switch (format) {
        case 'yaml':
            return yaml.stringify(output);
        case 'json':
            return JSON.stringify(output, null, 2);
        case 'text':
        default:
            if (result.exists) {
                return `✅ Zone: ${result.zone_id}\n   AGENTS.md: ${result.expected_agents_md} (exists)`;
            } else if (result.zone_id) {
                return `❌ Zone: ${result.zone_id}\n   AGENTS.md: ${result.expected_agents_md} (MISSING)`;
            } else {
                return `❌ No zone matches path: ${output.error || 'unknown'}`;
            }
    }
}

function showHelp(): void {
    console.log(`
FRIDA Check CLI v1.0

Usage:
  frida-check zone --path <working_dir> [--contract <path>] [--format yaml|json|text] [--trace]

Commands:
  zone    Resolve zone for a path and validate AGENTS.md

Options:
  --path <dir>     Working directory or file path to check
  --contract <path>   Contract file path (default resolution chain)
  --format <fmt>   Output format: yaml, json, or text (default: text)
  --trace          Include decision trace in output

Exit codes:
  0  Success: contractical AGENTS.md exists
  1  Error: zone resolved but AGENTS.md missing
  2  Error: zone could not be resolved

Examples:
  frida-check zone --path scripts/mapper --format yaml --trace
  frida-check zone --path tasks --format json
`);
}

export async function runFridaCheckCli(argv: string[] = process.argv.slice(2)): Promise<number> {
    const args = parseArgs(argv);

    if (args.command !== 'zone' || !args.path) {
        showHelp();
        return args.command ? 2 : 0;
    }

    const result = validateZoneAgentsMd(args.path, args.contractPath || undefined);
    console.log(formatOutput(result, args.format, args.trace));

    if (!result.zone_id) {
        return 2; // Zone not resolved
    } else if (!result.exists) {
        return 1; // AGENTS.md missing
    } else {
        return 0; // Success
    }
}

async function main(): Promise<void> {
    const code = await runFridaCheckCli(process.argv.slice(2));
    process.exit(code);
}

function isExecutedDirectly(moduleMetaUrl: string): boolean {
    const executedPath = process.argv[1];
    if (!executedPath) {
        return false;
    }
    return path.resolve(executedPath) === path.resolve(fileURLToPath(moduleMetaUrl));
}

if (isExecutedDirectly(import.meta.url)) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(2);
    });
}
