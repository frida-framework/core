/**
 * FRIDA Unified Generator v3.0
 * 
 * Generates agent context from contract data.
 * All data comes from the active contract artifact (prefer modular contract.index.yaml).
 * 
 * Sources:
 *   - contract/contract.index.yaml (modular contract index and layers)
 * 
 * Outputs:
 *   - AGENTS.md (bootloader)
 *   - .frida/contract/AGENTS.md (canonical internal mirror)
 *   - .frida/contract/specs/ROUTER.xml
 *   - .frida/contract/profiles/*.xml
 *   - {zone}/AGENTS.md
 *   - .frida/contract/docs/{policy,reference}/*.md
 *   - .frida/contract/artifacts/frida.ir.json
 *   - .frida/contract/artifacts/frida.permissions.json
 *   - .frida/contract/artifacts/frida.graph.mmd
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'yaml';
import Handlebars from 'handlebars';
import { loadContractDocument, resolveContractPath } from './contract-path.ts';
// === CONFIG ===
let ROOT_DIR = path.resolve(process.cwd());
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

function isEngineSelfRepo(rootDir: string): boolean {
    return path.resolve(rootDir) === ENGINE_PACKAGE_ROOT;
}

const AUTO_GENERATED_HEADER = '<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->\n\n';

// === TYPES ===
interface Zone {
    id: string;
    name?: string;
    path: string;
    is_component?: boolean;
    owner?: string;
    readOnly: boolean;
    whyReadOnly?: string;
    consequence?: string;
    redirectPath?: string;
    howToChange?: string;
    forbiddenOps?: string[];
    purpose?: string;
    agentsPath?: string;
    agentsTemplate?: string;
    constraints?: string[];
    verification?: string;
    guardRefs?: string[];
    note?: string;
    rules?: Array<{ title: string; text: string; example_wrong?: string; example_correct?: string; pattern?: string }>;
    testRequirements?: string[];
}

interface Contract {
    ZONES?: Record<string, any>;
    INT_FRIDA_ZONES?: Record<string, any>;
    TASK_PROFILES?: Record<string, any>;
    INVARIANTS?: Record<string, any>;
    FRIDA_TASK_PROFILES?: Record<string, any>;
    FRIDA_ENFORCEMENT?: {
        invariants?: Array<Record<string, any>>;
        policies?: Array<Record<string, any>>;
        [key: string]: any;
    };
    FRIDA_GUARDS_BASELINE?: GuardBlock;
    PROJECT_GUARDS?: GuardBlock;
    GUARDS?: GuardBlock;
    PATHS?: Record<string, any>;
    FRIDA_CONFIG?: {
        paths?: Record<string, any>;
        naming?: Record<string, any>;
        [key: string]: any;
    };
    [key: string]: any;
}

interface GeneratorRuntimePaths {
    contractArtifactPath: string;
    bootloaderFilePath: string;
    specsRootDir: string;
    profilesRootDir: string;
    docsPolicyDir: string;
    docsReferenceDir: string;
    fridaInternalDir: string;
    templatesFridaDir: string;
    templatesDocsDir: string;
    auditPlaybookPath: string;
    auditCoreContractPath: string;
    auditAppContractPath?: string;
    repoScope: 'frida_repo' | 'target_app_repo';
}

interface LoadedGeneratorContext {
    contract: Contract;
    contractRaw: string;
    runtimePaths: GeneratorRuntimePaths;
}

interface GuardBlock {
    version?: string;
    date?: string;
    globalGuardRefs?: string[];
    guards?: any[];
}

type GuardLayerName = 'FRIDA_GUARDS_BASELINE' | 'PROJECT_GUARDS' | 'GUARDS';
type ZoneBlockName = 'ZONES' | 'INT_FRIDA_ZONES';
type ProfileBlockName = 'TASK_PROFILES' | 'FRIDA_TASK_PROFILES';

interface EffectiveGuards {
    guards: any[];
    globalGuardRefs: string[];
    guardById: Map<string, any>;
    sourceById: Map<string, GuardLayerName>;
    layersUsed: GuardLayerName[];
}

function normalizeContractForGenerator(contract: Contract): Contract {
    const normalized: Contract = { ...contract };

    if (!normalized.INVARIANTS && Array.isArray(normalized.FRIDA_ENFORCEMENT?.invariants)) {
        normalized.INVARIANTS = Object.fromEntries(
            normalized.FRIDA_ENFORCEMENT.invariants
                .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
                .map((entry) => [entry.id, { ...entry, id: undefined }])
                .map(([id, entry]) => {
                    const normalizedEntry = { ...(entry as Record<string, any>) };
                    delete normalizedEntry.id;
                    return [id, normalizedEntry];
                })
        );
    }

    if (!normalized.GUARDS && Array.isArray(normalized.FRIDA_ENFORCEMENT?.policies)) {
        normalized.GUARDS = {
            globalGuardRefs: [],
            guards: normalized.FRIDA_ENFORCEMENT.policies,
        };
    }

    return normalized;
}

function getZoneBlockName(): ZoneBlockName {
    return isEngineSelfRepo(ROOT_DIR) ? 'INT_FRIDA_ZONES' : 'ZONES';
}

function getProfileBlockName(): ProfileBlockName {
    return isEngineSelfRepo(ROOT_DIR) ? 'FRIDA_TASK_PROFILES' : 'TASK_PROFILES';
}

function getZoneBlock(contract: Contract): Record<string, any> {
    const blockName = getZoneBlockName();
    const block = contract[blockName];
    if (!block || typeof block !== 'object') {
        return {};
    }
    return block as Record<string, any>;
}

function getProfileEntries(contract: Contract): Array<[string, any]> {
    const blockName = getProfileBlockName();
    const block = contract[blockName];
    if (!block || typeof block !== 'object') {
        return [];
    }

    return Object.entries(block).filter(([key, value]) => {
        if (['_visibility', 'id', 'version'].includes(key)) {
            return false;
        }
        return Boolean(value) && typeof value === 'object';
    });
}



export interface LegacyGeneratorAdapter {
    generate?: (context: any) => Promise<{ policyDocs?: number; referenceDocs?: number } | void> | { policyDocs?: number; referenceDocs?: number } | void;
}

export interface LegacyGeneratorOptions {
    adapter?: LegacyGeneratorAdapter;
}

// === IR TYPES (for machine-readable exports) ===
type IRKind = 'zone' | 'profile' | 'guard' | 'invariant' | 'path';

interface IRNode {
    id: string;
    kind: IRKind;
    label?: string;
    attrs?: any;
    source?: any;
}

interface IREdge {
    from: string;
    to: string;
    kind: string;
    attrs?: any;
}

interface FridaIR {
    meta: {
        generatedAt: string;
        contractSha256: string;
        pathMappingsCount: number;
        zoneCount: number;
        profileCount: number;
    };
    nodes: IRNode[];
    edges: IREdge[];
}


// === PATH NORMALIZER ===
class PathNormalizer {
    private mappings: Map<string, any> = new Map();

    constructor(pathsBlock?: Record<string, any>) {
        if (pathsBlock) {
            this.flattenPaths(pathsBlock, '');
        }
    }

    private flattenPaths(obj: any, prefix: string): void {
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                this.mappings.set(prefix + key, { contractical: value });
            } else if (typeof value === 'object' && value !== null) {
                if ((value as any).contractical) {
                    this.mappings.set(prefix + key, value);
                } else {
                    this.flattenPaths(value, prefix + key + '.');
                }
            }
        }
    }

    normalize(inputPath: string): { contractical: string; deprecated: boolean } {
        const cleaned = inputPath.replace(/^\.\//, '').replace(/^\//, '');

        for (const [, mapping] of this.mappings) {
            if (cleaned === mapping.contractical) {
                return { contractical: mapping.contractical, deprecated: false };
            }
            if (mapping.aliases?.includes(cleaned)) {
                return { contractical: mapping.contractical, deprecated: false };
            }
            if (mapping.deprecated?.includes(cleaned)) {
                return { contractical: mapping.contractical, deprecated: true };
            }
        }

        return { contractical: cleaned, deprecated: false };
    }

    getCount(): number {
        return this.mappings.size;
    }
}

// === HELPERS ===
function loadTemplate(dir: string, name: string): HandlebarsTemplateDelegate {
    const templatePath = path.join(dir, name);

    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template not found: ${templatePath}`);
    }

    return Handlebars.compile(fs.readFileSync(templatePath, 'utf-8'));
}

function write(filePath: string, content: string, addHeader = false): void {
    const fullContent = addHeader ? AUTO_GENERATED_HEADER + content : content;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, fullContent, 'utf-8');
    console.log(`✅ Generated: ${path.relative(ROOT_DIR, filePath)}`);
}

function resetDir(dirPath: string): void {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirContentsRecursive(sourceDir: string, targetDir: string): void {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDirContentsRecursive(sourcePath, targetPath);
            continue;
        }
        if (!entry.isFile()) continue;
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
    }
}

function resolveContractPathString(contract: Contract, ref: string | string[], fallback: string): string {
    const refs = Array.isArray(ref) ? ref : [ref];
    for (const candidate of refs) {
        const resolved = resolvePathRef(contract, candidate);
        if (typeof resolved === 'string' && resolved.trim()) {
            return resolved;
        }
    }
    return fallback;
}

function resolveArtifactFilePath(contract: Contract, refs: string[], fallbackPath: string): string {
    return fromRepoRoot(resolveContractPathString(contract, refs, fallbackPath));
}

function emitCanonicalMirrors(contract: Contract, runtimePaths: GeneratorRuntimePaths): void {
    // Root AGENTS.md remains the human/agent entrypoint. This internal mirror is engine-managed canonical state.
    const fridaContractBootloaderPath = fromRepoRoot(
        resolveContractPathString(
            contract,
            ['PATHS.frida.contract.bootloaderFile', 'PATHS.fridaContract.bootloaderFile'],
            '.frida/contract/AGENTS.md'
        )
    );
    if (fs.existsSync(runtimePaths.bootloaderFilePath) && fs.statSync(runtimePaths.bootloaderFilePath).isFile()) {
        fs.mkdirSync(path.dirname(fridaContractBootloaderPath), { recursive: true });
        fs.copyFileSync(runtimePaths.bootloaderFilePath, fridaContractBootloaderPath);
        console.log(
            `✅ Canonical mirror: ${path.relative(ROOT_DIR, fridaContractBootloaderPath)} <= ${path.relative(ROOT_DIR, runtimePaths.bootloaderFilePath)}`
        );
    }
}

function registerHelpers(): void {
    Handlebars.registerHelper('formatPath', (pathStr: string) => {
        return pathStr?.replace(/\\/g, '/') || '';
    });

    Handlebars.registerHelper('join', (arr: string[], delimiter: string) => {
        return arr ? arr.join(delimiter) : '';
    });

    Handlebars.registerHelper('eq', (a: any, b: any) => {
        return a === b;
    });

    Handlebars.registerHelper('groupBy', function (context: any[], key: string, options: any) {
        if (!context || !context.length) return '';
        const groups: Record<string, any[]> = {};
        for (const item of context) {
            const groupKey = item[key] || 'Platform';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(item);
        }
        let result = '';
        for (const [groupKey, items] of Object.entries(groups)) {
            result += options.fn({ group: groupKey, items: items });
        }
        return result;
    });
}

type SecurityListKey = 'read_allow' | 'edit_allow' | 'create_allow' | 'forbid' | 'edit_forbid';

function splitScopeValues(value: string): string[] {
    const normalizeResolvedPath = (input: string): string => {
        const cleaned = input.trim();
        // Contract PATHS keeps many file scopes as "*.ext*"; convert them to exact file paths for profile surfaces.
        if (/(^|\/)[^/*?[\]{}]+\.[^/*?[\]{}]+\*$/.test(cleaned)) {
            return cleaned.slice(0, -1);
        }
        return cleaned;
    };

    return value
        .split(',')
        .map(v => normalizeResolvedPath(v))
        .filter(Boolean);
}

function resolvePathNode(contract: Contract, ref: string): any | null {
    if (!ref.startsWith('PATHS.')) return null;

    const parts = ref.slice('PATHS.'.length).split('.');
    let cursor: any = contract.PATHS;

    for (const part of parts) {
        if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
            return null;
        }
        cursor = cursor[part];
    }

    return cursor;
}

function resolvePathRef(contract: Contract, ref: string): string | null {
    const cursor = resolvePathNode(contract, ref);
    if (cursor === null) {
        return null;
    }

    if (typeof cursor === 'string') {
        return cursor;
    }

    if (cursor && typeof cursor === 'object' && typeof cursor.contractical === 'string') {
        return cursor.contractical;
    }

    return null;
}

function failWithError(message: string): never {
    console.error(`❌ Error: ${message}`);
    process.exit(1);
}

function readContractFileOrFail(absolutePath: string): { contract: Contract; contractRaw: string } {
    try {
        const loaded = loadContractDocument(ROOT_DIR, absolutePath);
        return {
            contract: loaded.parsed as Contract,
            contractRaw: loaded.raw,
        };
    } catch (error) {
        failWithError(
            `failed to parse contract artifact '${path.relative(ROOT_DIR, absolutePath) || absolutePath}': ${error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

function getFridaConfigPathsOrFail(contract: Contract): Record<string, any> {
    if (!contract.FRIDA_CONFIG || typeof contract.FRIDA_CONFIG !== 'object') {
        failWithError('missing required contract block: FRIDA_CONFIG.');
    }
    const cfgPaths = contract.FRIDA_CONFIG.paths;
    if (!cfgPaths || typeof cfgPaths !== 'object') {
        failWithError('missing required block: FRIDA_CONFIG.paths.');
    }
    return cfgPaths;
}

function assertNoRemovedPathAliases(cfgPaths: Record<string, any>): void {
    const removedAliasKeys = [
        'agents_bootloader',
        'specs_root',
        'profiles_root',
        'docs_policy',
        'docs_reference',
        'frida_internal',
        'templates_frida',
        'templates_docs',
    ];

    const present = removedAliasKeys.filter((key) => typeof cfgPaths[key] === 'string' && cfgPaths[key].trim());
    if (present.length > 0) {
        failWithError(
            `removed FRIDA_CONFIG.paths aliases are no longer supported: ${present.map((key) => `FRIDA_CONFIG.paths.${key}`).join(', ')}`
        );
    }
}

function collectStringLeafPaths(node: any, out: string[] = []): string[] {
    if (typeof node === 'string') {
        out.push(node);
        return out;
    }
    if (!node || typeof node !== 'object') {
        return out;
    }
    for (const value of Object.values(node)) {
        collectStringLeafPaths(value, out);
    }
    return out;
}

function inferCommonDir(paths: string[]): string | null {
    if (paths.length === 0) return null;
    const split = paths
        .map(p => p.replace(/\\/g, '/'))
        .map(p => p.split('/').filter(Boolean));
    if (split.length === 0) return null;

    let common = split[0].slice();
    for (let i = 1; i < split.length; i++) {
        const cur = split[i];
        let j = 0;
        while (j < common.length && j < cur.length && common[j] === cur[j]) {
            j++;
        }
        common = common.slice(0, j);
        if (common.length === 0) {
            return null;
        }
    }
    return common.join('/');
}

function resolvePathRefOrFail(
    contract: Contract,
    ref: string,
    fieldPath: string,
    expectedKind: 'file' | 'dir'
): string {
    if (typeof ref !== 'string' || !ref.trim()) {
        failWithError(`${fieldPath} must be a non-empty PATHS.* reference.`);
    }
    if (!ref.startsWith('PATHS.')) {
        failWithError(`${fieldPath} must use PATHS.* reference format. Received: '${ref}'.`);
    }
    const node = resolvePathNode(contract, ref);
    if (node === null) {
        failWithError(`${fieldPath} references missing PATHS key '${ref}'.`);
    }

    if (typeof node === 'string') {
        return node;
    }
    if (node && typeof node === 'object' && typeof node.contractical === 'string') {
        return node.contractical;
    }

    if (expectedKind === 'dir' && node && typeof node === 'object') {
        if (typeof node.root === 'string' && node.root.trim()) {
            return node.root;
        }
        const leafPaths = collectStringLeafPaths(node).filter(Boolean);
        const inferredDir = inferCommonDir(leafPaths);
        if (inferredDir) {
            console.warn(
                `⚠️  ${fieldPath}: '${ref}' points to structured PATHS object. Using inferred directory '${inferredDir}'.`
            );
            return inferredDir;
        }
    }

    failWithError(
        `${fieldPath} references '${ref}' but does not resolve to a ${expectedKind} path string.`
    );
}

function resolveFridaConfigPath(
    contract: Contract,
    cfgPaths: Record<string, any>,
    options: {
        refField: string;
        expectedKind: 'file' | 'dir';
    }
): string {
    const { refField, expectedKind } = options;
    const refValue = cfgPaths[refField];
    const context = `FRIDA_CONFIG.paths.${refField}`;

    if (typeof refValue === 'string' && refValue.trim()) {
        const resolvedRelPath = resolvePathRefOrFail(contract, refValue, context, expectedKind);
        return fromRepoRoot(resolvedRelPath);
    }

    failWithError(`missing required ${expectedKind} path configuration FRIDA_CONFIG.paths.${refField}.`);
}

function resolveRepoScopedInterfacePathOrFail(
    contract: Contract,
    interfaceKey: string,
    repoScope: 'frida_repo' | 'target_app_repo',
    field: string
): string {
    const iface = (contract as Record<string, any>)[interfaceKey];
    if (!iface || typeof iface !== 'object') {
        failWithError(`missing required contract interface block: ${interfaceKey}.`);
    }

    const scopedSurfaces = (iface as Record<string, any>).repository_scoped_surfaces;
    if (!scopedSurfaces || typeof scopedSurfaces !== 'object') {
        failWithError(`${interfaceKey}.repository_scoped_surfaces is missing.`);
    }

    const scoped = (scopedSurfaces as Record<string, any>)[repoScope];
    if (!scoped || typeof scoped !== 'object') {
        failWithError(`${interfaceKey}.repository_scoped_surfaces.${repoScope} is missing.`);
    }

    const rawValue = (scoped as Record<string, any>)[field];
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
        failWithError(`${interfaceKey}.repository_scoped_surfaces.${repoScope}.${field} is missing or empty.`);
    }

    if (rawValue.startsWith('PATHS.')) {
        return resolvePathRefOrFail(
            contract,
            rawValue,
            `${interfaceKey}.repository_scoped_surfaces.${repoScope}.${field}`,
            'file'
        );
    }

    return rawValue;
}

function loadAuditInterfaceContract(repoScope: 'frida_repo' | 'target_app_repo', currentContract: Contract): Contract {
    if (repoScope === 'frida_repo' && (currentContract as Record<string, any>).FRIDA_INTERFACE_AUDIT) {
        return currentContract;
    }

    if ((currentContract as Record<string, any>).FRIDA_INTERFACE_AUDIT) {
        return currentContract;
    }

    const engineContractPath = path.join(ENGINE_PACKAGE_ROOT, 'contract', 'contract.index.yaml');
    const loaded = loadContractDocument(ENGINE_PACKAGE_ROOT, engineContractPath);
    return loaded.parsed as Contract;
}

function resolvePathValue(contract: Contract, value: string, context: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith('PATHS.')) {
        const resolved = resolvePathRef(contract, trimmed);
        if (!resolved) {
            console.warn(`⚠️  ${context}: unresolved path reference '${trimmed}'`);
            return [];
        }
        return splitScopeValues(resolved);
    }

    return splitScopeValues(trimmed);
}

function resolveSecurityList(
    contract: Contract,
    security: any,
    key: SecurityListKey,
    context: string
): string[] {
    const refKey = `${key}GlobRefs`;
    const values: string[] = [];
    const pushUnique = (item: string) => {
        if (!values.includes(item)) values.push(item);
    };

    const applyRawList = (rawList: any[], listContext: string) => {
        for (const raw of rawList) {
            if (typeof raw !== 'string') continue;
            for (const resolved of resolvePathValue(contract, raw, listContext)) {
                pushUnique(resolved);
            }
        }
    };

    if (Array.isArray(security?.[key])) {
        applyRawList(security[key], `${context}.${key}`);
    }
    if (Array.isArray(security?.[refKey])) {
        applyRawList(security[refKey], `${context}.${refKey}`);
    }

    return values;
}

function resolveSecurity(contract: Contract, security: any, context: string): Record<SecurityListKey, string[]> {
    return {
        read_allow: resolveSecurityList(contract, security, 'read_allow', context),
        edit_allow: resolveSecurityList(contract, security, 'edit_allow', context),
        create_allow: resolveSecurityList(contract, security, 'create_allow', context),
        forbid: resolveSecurityList(contract, security, 'forbid', context),
        edit_forbid: resolveSecurityList(contract, security, 'edit_forbid', context),
    };
}

function resolveRefValue(contract: Contract, value: any, context: string): string | null {
    if (typeof value !== 'string') return null;
    const resolved = resolvePathValue(contract, value, context);
    return resolved.length > 0 ? resolved.join(', ') : null;
}

function resolveGuardEnforcement(contract: Contract, enforcement: any, context: string): any {
    if (!enforcement || typeof enforcement !== 'object') return enforcement;

    const resolved = { ...enforcement };

    if (!resolved.verifier && typeof enforcement.verifierScriptRef === 'string') {
        const verifier = resolveRefValue(contract, enforcement.verifierScriptRef, `${context}.verifierScriptRef`);
        if (verifier) resolved.verifier = verifier;
    }
    if (!resolved.generator && typeof enforcement.generatorScriptRef === 'string') {
        const generator = resolveRefValue(contract, enforcement.generatorScriptRef, `${context}.generatorScriptRef`);
        if (generator) resolved.generator = generator;
    }
    if (!resolved.scope && typeof enforcement.scopeGlobRef === 'string') {
        const scope = resolveRefValue(contract, enforcement.scopeGlobRef, `${context}.scopeGlobRef`);
        if (scope) resolved.scope = scope;
    }

    return resolved;
}

function resolveGuard(contract: Contract, guard: any, sourceBlock: GuardLayerName | string = 'GUARDS'): any {
    if (!guard || typeof guard !== 'object') return guard;
    return {
        ...guard,
        enforcement: resolveGuardEnforcement(contract, guard.enforcement, `${sourceBlock}.${guard.id || 'unknown'}.enforcement`),
    };
}

const GUARD_LAYER_ORDER: GuardLayerName[] = ['FRIDA_GUARDS_BASELINE', 'PROJECT_GUARDS', 'GUARDS'];

function collectEffectiveGuards(contract: Contract, strict = false): EffectiveGuards {
    const layersUsed = GUARD_LAYER_ORDER.filter(layer => !!contract[layer]);
    if (layersUsed.length === 0) {
        if (strict) {
            throw new Error(
                'No guard source found. Define at least one of: FRIDA_GUARDS_BASELINE, PROJECT_GUARDS, GUARDS.'
            );
        }
        return {
            guards: [],
            globalGuardRefs: [],
            guardById: new Map(),
            sourceById: new Map(),
            layersUsed: [],
        };
    }

    const globalGuardRefs: string[] = [];
    const seenGlobalRefs = new Set<string>();
    const guardById = new Map<string, any>();
    const sourceById = new Map<string, GuardLayerName>();
    const orderedIds: string[] = [];

    const failOrWarn = (message: string): void => {
        if (strict) {
            throw new Error(message);
        }
        console.warn(`⚠️  ${message}`);
    };

    for (const layer of GUARD_LAYER_ORDER) {
        const block = contract[layer];
        if (!block) continue;

        if (block.globalGuardRefs !== undefined && !Array.isArray(block.globalGuardRefs)) {
            failOrWarn(`${layer}.globalGuardRefs must be an array`);
            continue;
        }
        for (const ref of block.globalGuardRefs || []) {
            if (typeof ref !== 'string' || !ref.trim()) {
                failOrWarn(`${layer}.globalGuardRefs contains non-string or empty entry`);
                continue;
            }
            if (!seenGlobalRefs.has(ref)) {
                seenGlobalRefs.add(ref);
                globalGuardRefs.push(ref);
            }
        }

        if (block.guards !== undefined && !Array.isArray(block.guards)) {
            failOrWarn(`${layer}.guards must be an array`);
            continue;
        }

        const seenIdsInLayer = new Set<string>();
        for (let i = 0; i < (block.guards || []).length; i++) {
            const guard = block.guards![i];
            if (!guard || typeof guard !== 'object') {
                failOrWarn(`${layer}.guards[${i}] must be an object`);
                continue;
            }
            if (!guard.id || !guard.kind || !guard.statement) {
                failOrWarn(`${layer}.guards[${i}] missing required fields (id/kind/statement)`);
                continue;
            }
            if (seenIdsInLayer.has(guard.id)) {
                failOrWarn(`${layer}.guards contains duplicate id '${guard.id}'`);
                continue;
            }
            seenIdsInLayer.add(guard.id);

            if (!guardById.has(guard.id)) {
                orderedIds.push(guard.id);
            }
            guardById.set(guard.id, resolveGuard(contract, guard, layer));
            sourceById.set(guard.id, layer);
        }
    }

    const guards = orderedIds
        .map(id => guardById.get(id))
        .filter(Boolean);

    return {
        guards,
        globalGuardRefs,
        guardById,
        sourceById,
        layersUsed,
    };
}

// === IR HELPERS ===
function sha256Text(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveGeneratedAt(): string {
    const fixed = process.env.FRIDA_GENERATED_AT?.trim();
    return fixed && fixed.length > 0 ? fixed : new Date().toISOString();
}

function toNodeId(kind: IRKind, rawId: string): string {
    return `${kind}:${rawId}`;
}

function fromRepoRoot(contractPath: string): string {
    // contractPath may be "/.frida/x" or ".frida/x" — strip leading slashes/dots
    const cleaned = contractPath.replace(/^\.\//, '').replace(/^\/+/, '');
    return path.join(ROOT_DIR, cleaned);
}

function mermaidId(nodeId: string): string {
    return 'n_' + crypto.createHash('sha1').update(nodeId, 'utf8').digest('hex').slice(0, 12);
}

// === IR BUILDER ===
function buildFridaIR(
    contract: Contract,
    contractRaw: string,
    zones: Zone[],
    profiles: any[],
    normalizer: PathNormalizer,
    effectiveGuards: EffectiveGuards
): FridaIR {
    const nodes: IRNode[] = [];
    const edges: IREdge[] = [];

    // Guards
    const guards = effectiveGuards.guards;
    for (const g of guards) {
        nodes.push({
            id: toNodeId('guard', g.id),
            kind: 'guard',
            label: g.id,
            attrs: { kind: g.kind, statement: g.statement, enforcement: g.enforcement || null },
            source: { block: effectiveGuards.sourceById.get(g.id) || 'GUARDS', id: g.id },
        });
    }

    // Invariants
    const invariants = contract.INVARIANTS || {};
    for (const [invId, inv] of Object.entries(invariants)) {
        nodes.push({
            id: toNodeId('invariant', invId),
            kind: 'invariant',
            label: invId,
            attrs: inv,
            source: { block: 'INVARIANTS', id: invId },
        });
    }

    // Zones (+ zone->guard edges)
    const zoneBlockName = getZoneBlockName();
    for (const z of zones) {
        nodes.push({
            id: toNodeId('zone', z.id),
            kind: 'zone',
            label: z.name || formatZoneName(z.id),
            attrs: {
                path: z.path,
                agentsPath: z.agentsPath,
                agentsTemplate: z.agentsTemplate,
                readOnly: z.readOnly,
            },
            source: { block: zoneBlockName, id: z.id },
        });

        for (const gr of z.guardRefs || []) {
            edges.push({
                from: toNodeId('zone', z.id),
                to: toNodeId('guard', gr),
                kind: 'guarded_by',
            });
        }
    }

    // Profiles (+ profile->invariant edges)
    for (const p of profiles) {
        nodes.push({
            id: toNodeId('profile', p.id),
            kind: 'profile',
            label: p.id,
            attrs: {
                keywords: p.keywords,
                security: p.security,
            },
            source: { block: profileBlockName, id: p.id },
        });

        for (const inv of p.resolvedInvariants || []) {
            edges.push({
                from: toNodeId('profile', p.id),
                to: toNodeId('invariant', inv.id),
                kind: 'requires',
            });
        }
    }

    // Path nodes + access edges (profile -> path)
    const pathIds = new Set<string>();
    const ensurePathNode = (p: string) => {
        const contract = normalizer.normalize(p).contractical;
        if (!pathIds.has(contract)) {
            pathIds.add(contract);
            nodes.push({
                id: toNodeId('path', contract),
                kind: 'path',
                label: contract,
                attrs: { contractical: contract },
            });
        }
        return contract;
    };

    for (const p of profiles) {
        const sec = p.security || {};
        for (const rp of sec.read_allow || []) {
            const contract = ensurePathNode(rp);
            edges.push({ from: toNodeId('profile', p.id), to: toNodeId('path', contract), kind: 'may_read' });
        }
        for (const ep of sec.edit_allow || []) {
            const contract = ensurePathNode(ep);
            edges.push({ from: toNodeId('profile', p.id), to: toNodeId('path', contract), kind: 'may_edit' });
        }
        for (const fp of sec.forbid || []) {
            const contract = ensurePathNode(fp);
            edges.push({ from: toNodeId('profile', p.id), to: toNodeId('path', contract), kind: 'forbidden' });
        }
        for (const nfp of sec.edit_forbid || []) {
            const contract = ensurePathNode(nfp);
            edges.push({ from: toNodeId('profile', p.id), to: toNodeId('path', contract), kind: 'no_edit' });
        }
        for (const cp of sec.create_allow || []) {
            const contract = ensurePathNode(cp);
            edges.push({ from: toNodeId('profile', p.id), to: toNodeId('path', contract), kind: 'may_create' });
        }
    }

    // Derive profile->zone edges (for visualization)
    for (const p of profiles) {
        const sec = p.security || {};
        const allow = new Set<string>([...(sec.read_allow || []), ...(sec.edit_allow || [])]);
        for (const z of zones) {
            let covered = false;
            for (const a of allow) {
                if (isZoneCovered(a, z.path, z.agentsPath || '')) {
                    covered = true;
                    break;
                }
            }
            if (covered) {
                edges.push({
                    from: toNodeId('profile', p.id),
                    to: toNodeId('zone', z.id),
                    kind: 'may_access_zone',
                });
            }
        }
    }

    return {
        meta: {
            generatedAt: resolveGeneratedAt(),
            contractSha256: sha256Text(contractRaw),
            pathMappingsCount: normalizer.getCount(),
            zoneCount: zones.length,
            profileCount: profiles.length,
        },
        nodes,
        edges,
    };
}

function emitMachineReadableExports(
    ir: FridaIR,
    zones: Zone[],
    profiles: any[],
    irPath: string,
    permissionsPath: string,
    graphPath: string
): void {
    // IR JSON (source for tools, graph renderers, lint)
    write(irPath, JSON.stringify(ir, null, 2));

    // Permissions snapshot (compact)
    const permissions = {
        meta: ir.meta,
        zones: zones.map(z => ({
            id: z.id,
            name: z.name || formatZoneName(z.id),
            path: z.path,
            agentsPath: z.agentsPath,
            readOnly: z.readOnly,
            guardRefs: z.guardRefs || [],
        })),
        profiles: profiles.map(p => ({
            id: p.id,
            keywords: p.keywords,
            security: p.security,
            invariants: (p.resolvedInvariants || []).map((x: any) => x.id),
        })),
    };
    write(permissionsPath, JSON.stringify(permissions, null, 2));

    // Mermaid graph (human-readable quick viz) with stable hash-based IDs
    const idMap = new Map<string, string>();
    for (const node of ir.nodes) {
        idMap.set(node.id, mermaidId(node.id));
    }

    const lines: string[] = ['flowchart TD'];

    // Declare nodes with labels
    for (const node of ir.nodes) {
        const mid = idMap.get(node.id)!;
        const label = (node.label || node.id).replace(/"/g, '\\"');
        lines.push(`  ${mid}["${label}"]`);
    }

    // Add edges (skip noisy path-edges)
    for (const e of ir.edges) {
        if (['may_read', 'may_edit', 'forbidden', 'no_edit', 'may_create'].includes(e.kind)) continue;
        const from = idMap.get(e.from);
        const to = idMap.get(e.to);
        if (from && to) {
            lines.push(`  ${from} -->|${e.kind}| ${to}`);
        }
    }
    write(graphPath, lines.join('\n') + '\n');
}

// === CONTRACT LOADERS ===
function loadGeneratorContext(): LoadedGeneratorContext {
    let contractPath = resolveContractPath(ROOT_DIR);
    let loaded = readContractFileOrFail(contractPath);
    const explicitContractPath = process.env.FRIDA_CONTRACT_PATH?.trim();
    const normalizedContractPath = path.resolve(contractPath).replace(/\\/g, '/');
    const contractPathIsInboxSource = normalizedContractPath.includes('/.frida/inbox/app-contract/');
    const honorExplicitContractPath = Boolean(explicitContractPath) || contractPathIsInboxSource;

    // Resolve contract path from FRIDA_CONFIG and re-load if the canonical contract artifact differs from bootstrap location.
    // If FRIDA_CONTRACT_PATH is explicitly set (for example bootstrap post-gen with inbox-only contract source),
    // the explicit path is authoritative and re-resolve fallback is disabled.
    if (!honorExplicitContractPath) {
        for (let i = 0; i < 2; i++) {
            const cfgPaths = getFridaConfigPathsOrFail(loaded.contract);
            if (!cfgPaths.canon_inputFileRef) break;
            const contractRel = resolvePathRefOrFail(
                loaded.contract,
                cfgPaths.canon_inputFileRef,
                'FRIDA_CONFIG.paths.canon_inputFileRef',
                'file'
            );
            const resolvedContractPath = path.resolve(fromRepoRoot(contractRel));
            if (resolvedContractPath === contractPath) {
                break;
            }
            contractPath = resolvedContractPath;
            loaded = readContractFileOrFail(contractPath);
        }
    } else {
        const cfgPaths = getFridaConfigPathsOrFail(loaded.contract);
        if (cfgPaths.canon_inputFileRef) {
            const contractRel = resolvePathRefOrFail(
                loaded.contract,
                cfgPaths.canon_inputFileRef,
                'FRIDA_CONFIG.paths.canon_inputFileRef',
                'file'
            );
            const resolvedContractPath = path.resolve(fromRepoRoot(contractRel));
            if (resolvedContractPath !== contractPath) {
                console.warn(
                    `⚠️  Contract source is fixed to ${path.relative(ROOT_DIR, contractPath) || contractPath}; skipping FRIDA_CONFIG.paths.canon_inputFileRef fallback to ${path.relative(ROOT_DIR, resolvedContractPath) || resolvedContractPath}`
                );
            }
        }
    }

    const cfgPaths = getFridaConfigPathsOrFail(loaded.contract);
    assertNoRemovedPathAliases(cfgPaths);
    const repoScope = isEngineSelfRepo(ROOT_DIR) ? 'frida_repo' : 'target_app_repo';
    const auditInterfaceContract = loadAuditInterfaceContract(repoScope, loaded.contract);
    const runtimePaths: GeneratorRuntimePaths = {
        contractArtifactPath: contractPath,
        bootloaderFilePath: resolveFridaConfigPath(loaded.contract, cfgPaths, {
            refField: 'agents_bootloaderFileRef',
            expectedKind: 'file',
        }),
        specsRootDir: resolveFridaConfigPath(loaded.contract, cfgPaths, {
            refField: 'specs_rootRef',
            expectedKind: 'dir',
        }),
        profilesRootDir: resolveFridaConfigPath(loaded.contract, cfgPaths, {
            refField: 'profiles_rootRef',
            expectedKind: 'dir',
        }),
        docsPolicyDir: resolveFridaConfigPath(loaded.contract, cfgPaths, {
            refField: 'docs_policyDirRef',
            expectedKind: 'dir',
        }),
        docsReferenceDir: resolveFridaConfigPath(loaded.contract, cfgPaths, {
            refField: 'docs_referenceDirRef',
            expectedKind: 'dir',
        }),
        fridaInternalDir: resolveFridaConfigPath(loaded.contract, cfgPaths, {
            refField: 'frida_internalRef',
            expectedKind: 'dir',
        }),
        templatesFridaDir: repoScope === 'frida_repo'
            ? resolveFridaConfigPath(loaded.contract, cfgPaths, {
                refField: 'templates_fridaRef',
                expectedKind: 'dir',
            })
            : path.resolve(ENGINE_PACKAGE_ROOT, 'templates', 'frida'),
        templatesDocsDir: repoScope === 'frida_repo'
            ? resolveFridaConfigPath(loaded.contract, cfgPaths, {
                refField: 'templates_docsRef',
                expectedKind: 'dir',
            })
            : path.resolve(ENGINE_PACKAGE_ROOT, 'templates', 'docs-gen'),
        auditPlaybookPath: resolveRepoScopedInterfacePathOrFail(
            auditInterfaceContract,
            'FRIDA_INTERFACE_AUDIT',
            repoScope,
            'playbook_ref'
        ),
        auditCoreContractPath: resolveRepoScopedInterfacePathOrFail(
            auditInterfaceContract,
            'FRIDA_INTERFACE_AUDIT',
            repoScope,
            'core_contract_ref'
        ),
        auditAppContractPath: repoScope === 'frida_repo'
            ? undefined
            : resolveRepoScopedInterfacePathOrFail(
                auditInterfaceContract,
                'FRIDA_INTERFACE_AUDIT',
                repoScope,
                'app_contract_ref'
            ),
        repoScope,
    };

    return {
        contract: loaded.contract,
        contractRaw: loaded.contractRaw,
        runtimePaths,
    };
}

function validateContract(contract: Contract): EffectiveGuards {
    const zoneBlockName = getZoneBlockName();
    const profileBlockName = getProfileBlockName();
    const required = [zoneBlockName, profileBlockName, 'INVARIANTS'];
    const missing = required.filter(key => !contract[key]);

    if (missing.length > 0) {
        console.error(`❌ Error: Missing required blocks in contract: ${missing.join(', ')}`);
        console.error('   Ensure the repository-scoped contract provides the required top-level blocks.');
        process.exit(1);
    }

    // D1: Validate composed guard registry
    let effectiveGuards: EffectiveGuards;
    try {
        effectiveGuards = collectEffectiveGuards(contract, true);
    } catch (error) {
        console.error(`❌ Error: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
    const guardIds = new Set(effectiveGuards.guards.map((g: any) => g.id));

    const unresolvedGlobalGuardRefs = effectiveGuards.globalGuardRefs.filter(ref => !guardIds.has(ref));
    if (unresolvedGlobalGuardRefs.length > 0) {
        console.error('❌ Error: unresolved global guard refs in effective guard registry:');
        console.error(`   Missing guards: ${unresolvedGlobalGuardRefs.join(', ')}`);
        process.exit(1);
    }

    // D2: Validate redirects format in the repository-scoped profile block
    for (const [profileId, profileData] of getProfileEntries(contract)) {
        const redirects = (profileData as any).security?.redirects || (profileData as any).redirects;
        if (redirects && Array.isArray(redirects)) {
            for (let i = 0; i < redirects.length; i++) {
                const r = redirects[i];
                if (r.pattern || r.redirectTo || r.message) {
                    console.error(`❌ Error: ${profileBlockName}.${profileId}.redirects[${i}] uses deprecated format (pattern/redirectTo/message). Use from/to/reason or fromGlobRef/toFileRef|toDirRef/reason.`);
                    process.exit(1);
                }
                const hasCompatShape = typeof r.from === 'string' && typeof r.to === 'string';
                const hasRefShape = typeof r.fromGlobRef === 'string' &&
                    (typeof r.toFileRef === 'string' || typeof r.toDirRef === 'string');
                if (!r.reason || (!hasCompatShape && !hasRefShape)) {
                    console.error(
                        `❌ Error: ${profileBlockName}.${profileId}.redirects[${i}] missing required fields ` +
                        `(from/to/reason OR fromGlobRef/toFileRef|toDirRef/reason)`
                    );
                    process.exit(1);
                }
            }
        }
    }

    // D3: Validate guardRef resolve (VALIDATION_RULES_APP + repo-scoped zone block)
    const validationRulesApp = contract['VALIDATION_RULES_APP'];
    if (validationRulesApp) {
        const unresolvedGuards: string[] = [];
        for (const [, rules] of Object.entries(validationRulesApp)) {
            if (Array.isArray(rules)) {
                for (const rule of rules) {
                    if (rule.guardRef && !guardIds.has(rule.guardRef)) {
                        unresolvedGuards.push(rule.guardRef);
                    }
                }
            }
        }
        if (unresolvedGuards.length > 0) {
            console.error(`❌ Error: VALIDATION_RULES_APP contains unresolved guardRef:`);
            console.error(`   Missing from effective guard registry: ${unresolvedGuards.join(', ')}`);
            process.exit(1);
        }
    }
    const unresolvedZoneGuardRefs: string[] = [];
    for (const [zoneId, zoneData] of getZoneEntries(contract)) {
        const refs = (zoneData as any).guardRefs;
        if (!Array.isArray(refs)) continue;
        for (const ref of refs) {
            if (typeof ref === 'string' && !guardIds.has(ref)) {
                unresolvedZoneGuardRefs.push(`${zoneBlockName}.${zoneId}.guardRefs -> ${ref}`);
            }
        }
    }
    if (unresolvedZoneGuardRefs.length > 0) {
        console.error(`❌ Error: ${zoneBlockName} contains unresolved guardRefs:`);
        for (const item of unresolvedZoneGuardRefs) {
            console.error(`   ${item}`);
        }
        process.exit(1);
    }

    // D4: Validate invariants resolve in the repository-scoped profile block
    for (const [profileId, profileData] of getProfileEntries(contract)) {
        const invariants = (profileData as any).invariants;
        if (invariants && Array.isArray(invariants)) {
            const missingInvariants: string[] = [];
            for (const invId of invariants) {
                if (!contract.INVARIANTS?.[invId]) {
                    missingInvariants.push(invId);
                }
            }
            if (missingInvariants.length > 0) {
                console.error(`❌ Error: ${profileBlockName}.${profileId}.invariants contains undefined invariants:`);
                console.error(`   Missing: ${missingInvariants.join(', ')}`);
                process.exit(1);
            }
        }
    }

    // D5: Validate tasks orchestration policy in the repository-scoped profile block
    const tasksPolicyErrors: string[] = [];
    const matchesPath = (candidate: string, expected: string): boolean => {
        return candidate === expected || candidate === `${expected}*`;
    };
    const has = (arr: any[], expected: string): boolean =>
        Array.isArray(arr) && arr.some(v => typeof v === 'string' && matchesPath(v, expected));
    const hasAny = (arr: any[], expectedList: string[]): boolean =>
        expectedList.some((expected) => has(arr, expected));
    const accessValidation = (contract.FRIDA_CONFIG as any)?.reporting?.access_validation || {};
    const repoPolicies = (accessValidation && typeof accessValidation === 'object' && accessValidation.repo_policies
        && typeof accessValidation.repo_policies === 'object')
        ? accessValidation.repo_policies as Record<string, unknown>
        : {};
    const repoPolicyKey = isEngineSelfRepo(ROOT_DIR) ? 'frida_core' : 'target_app';
    const policyPaths = (repoPolicies[repoPolicyKey] && typeof repoPolicies[repoPolicyKey] === 'object')
        ? repoPolicies[repoPolicyKey] as Record<string, unknown>
        : {};
    const policyList = (key: string, fallback: string[]): string[] => {
        const value = policyPaths[key];
        if (!Array.isArray(value)) {
            return fallback;
        }
        return value.filter((item) => typeof item === 'string' && item.trim()) as string[];
    };

    const readAllowRequired = policyList('read_allow_required', ['tasks/**']);
    const readAllowGovernanceRequired = policyList('read_allow_governance_required', []);
    const readAllowTaskSetterRequired = policyList('read_allow_task_setter_required', []);
    const contractEditorProfileIds = policyList('contract_editor_profile_ids', ['app_contract_editor']);
    const readAllowContractEditorRequired = policyList('read_allow_contract_editor_required', []);
    const editAllowArchitectRequired = policyList('edit_allow_architect_required', ['tasks/inbox/**']);
    const editAllowArchitectAllowedOnly = policyList('edit_allow_architect_allowed_only', ['tasks/inbox/**', 'tasks/inbox/README.md']);
    const editAllowContractEditorRequired = policyList('edit_allow_contract_editor_required', []);
    const editAllowContractEditorAllowedOnly = policyList('edit_allow_contract_editor_allowed_only', []);
    const editAllowNonArchitectRequired = policyList('edit_allow_non_architect_required', ['tasks/README.md', 'tasks/**/README.md']);
    const editForbidRequired = policyList('edit_forbid_required', ['tasks/TASK-*.md', 'tasks/**/TASK-*.md', '.frida/reports/*.yaml']);
    const forbidMustInclude = policyList('forbid_must_include', ['.frida/**']);
    const forbidMustNotInclude = policyList('forbid_must_not_include', ['tasks/**', 'tasks/README.md', 'tasks/**/README.md', 'tasks/TASK-*.md', 'tasks/**/TASK-*.md']);
    const createAllowRequiredAllProfiles = policyList('create_allow_required_all_profiles', ['.frida/reports/*.yaml']);
    const createAllowNonTaskSetterAllowedOnly = policyList('create_allow_non_task_setter_allowed_only', ['tasks/sessions/*.md', 'tasks/sessions/[0-9]*-*.md', '.frida/reports/*.yaml']);
    const createAllowTaskSetterRequired = policyList('create_allow_task_setter_required', ['tasks/TASK-*.md']);
    const createAllowTaskSetterForbidden = policyList('create_allow_task_setter_forbidden', ['tasks/**']);
    const reportingReadPath = (() => {
        const fromPolicy = policyList('read_allow_reporting_required', []);
        if (fromPolicy.length > 0) return fromPolicy[0];
        const fromAcl = (contract as any)?.REPORTING_ACCESS_POLICY?.acl_projection?.read_allow_governance_glob;
        return typeof fromAcl === 'string' && fromAcl.trim() ? fromAcl : '.frida/reports/*.yaml';
    })();
    const accessValidationEnabled =
        (contract.FRIDA_CONFIG as any)?.reporting?.access_validation?.enabled === true;

    if (!accessValidationEnabled) {
        // D5 access validation requires FRIDA_CONFIG.reporting.access_validation.enabled=true;
        // silently skip when absent (app-only contracts do not define this block).
    } else {
        for (const [profileId, profileData] of getProfileEntries(contract)) {
            const sec = (profileData as any).security || {};
            const role = (profileData as any).role;
            const isArchitect = role === 'ARCHITECT_AGENT';
            const isContractEditorProfile = contractEditorProfileIds.includes(profileId);
            const isGovernanceProfile = profileId === 'frida_governance' || profileId === 'app_governance';
            const isTaskSetterProfile = role === 'TASK_SETTER_AGENT';
            const resolvedSec = resolveSecurity(contract, sec, `${profileBlockName}.${profileId}.security`);
            const readAllow = resolvedSec.read_allow;
            const editAllow = resolvedSec.edit_allow;
            const editForbid = resolvedSec.edit_forbid;
            const forbid = resolvedSec.forbid;

            // Check required read_allow
            for (const requiredPath of readAllowRequired) {
                if (!has(readAllow, requiredPath)) {
                    tasksPolicyErrors.push(`${profileBlockName}.${profileId}: missing security.read_allow "${requiredPath}"`);
                }
            }
            if (isGovernanceProfile) {
                for (const requiredPath of readAllowGovernanceRequired) {
                    if (!has(readAllow, requiredPath)) {
                        tasksPolicyErrors.push(`${profileBlockName}.${profileId}: governance profile missing security.read_allow "${requiredPath}"`);
                    }
                }
            }
            if (isTaskSetterProfile) {
                for (const requiredPath of readAllowTaskSetterRequired) {
                    if (!has(readAllow, requiredPath)) {
                        tasksPolicyErrors.push(`${profileBlockName}.${profileId}: TASK_SETTER_AGENT missing security.read_allow "${requiredPath}"`);
                    }
                }
            }
            if (isContractEditorProfile) {
                for (const requiredPath of readAllowContractEditorRequired) {
                    if (!has(readAllow, requiredPath)) {
                        tasksPolicyErrors.push(`${profileBlockName}.${profileId}: contract editor profile missing security.read_allow "${requiredPath}"`);
                    }
                }
            }

            // Check required edit_allow based on role
            if (isArchitect) {
                const requiredArchitectEditAllow = isContractEditorProfile && editAllowContractEditorRequired.length > 0
                    ? editAllowContractEditorRequired
                    : editAllowArchitectRequired;
                const allowedArchitectEditAllow = isContractEditorProfile && editAllowContractEditorAllowedOnly.length > 0
                    ? editAllowContractEditorAllowedOnly
                    : editAllowArchitectAllowedOnly;

                for (const requiredPath of requiredArchitectEditAllow) {
                    if (!has(editAllow, requiredPath)) {
                        tasksPolicyErrors.push(`${profileBlockName}.${profileId}: ARCHITECT_AGENT must include security.edit_allow "${requiredPath}"`);
                    }
                }

                const disallowedArchitectWrites = editAllow.filter((p: any) => (
                    typeof p === 'string' &&
                    !hasAny([p], allowedArchitectEditAllow)
                ));
                if (disallowedArchitectWrites.length > 0) {
                    tasksPolicyErrors.push(
                        `${profileBlockName}.${profileId}: ARCHITECT_AGENT edit_allow contains paths outside policy allowlist (found: ${disallowedArchitectWrites.join(', ')})`
                    );
                }
            } else {
                for (const requiredPath of editAllowNonArchitectRequired) {
                    if (!has(editAllow, requiredPath)) {
                        tasksPolicyErrors.push(`${profileBlockName}.${profileId}: missing security.edit_allow "${requiredPath}"`);
                    }
                }
            }

            // Check required edit_forbid
            for (const requiredPath of editForbidRequired) {
                if (!has(editForbid, requiredPath)) {
                    tasksPolicyErrors.push(`${profileBlockName}.${profileId}: missing security.edit_forbid "${requiredPath}"`);
                }
            }

            // Check forbidden patterns in security.forbid
            for (const forbiddenPath of forbidMustNotInclude) {
                if (has(forbid, forbiddenPath)) {
                    tasksPolicyErrors.push(`${profileBlockName}.${profileId}: security.forbid MUST NOT include "${forbiddenPath}"`);
                }
            }

            // Check required .frida/** in forbid
            for (const requiredPath of forbidMustInclude) {
                if (!has(forbid, requiredPath)) {
                    tasksPolicyErrors.push(`${profileBlockName}.${profileId}: security.forbid MUST include "${requiredPath}"`);
                }
            }

            // Check create_allow policy
            const createAllow = resolvedSec.create_allow;
            for (const requiredPath of createAllowRequiredAllProfiles) {
                if (!has(createAllow, requiredPath)) {
                    tasksPolicyErrors.push(`${profileBlockName}.${profileId}: missing security.create_allow "${requiredPath}"`);
                }
            }

            const hasReportingRead = has(readAllow, reportingReadPath);
            if (isGovernanceProfile && !hasReportingRead) {
                tasksPolicyErrors.push(`${profileBlockName}.${profileId}: governance profile must include security.read_allow "${reportingReadPath}"`);
            }
            if (!isGovernanceProfile && hasReportingRead) {
                tasksPolicyErrors.push(`${profileBlockName}.${profileId}: only governance profile may include security.read_allow "${reportingReadPath}"`);
            }

            if (createAllow.length > 0) {
                const isAllowedNonTaskSetterCreatePath = (p: string) => hasAny([p], createAllowNonTaskSetterAllowedOnly);

                if (!isTaskSetterProfile) {
                    const invalidCreates = createAllow.filter(
                        (p: any) => typeof p === 'string' && !isAllowedNonTaskSetterCreatePath(p)
                    );
                    if (invalidCreates.length > 0) {
                        tasksPolicyErrors.push(
                            `${profileBlockName}.${profileId}: non-task-setter create_allow may target only configured policy paths (found: ${invalidCreates.join(', ')})`
                        );
                    }
                } else {
                    for (const requiredPath of createAllowTaskSetterRequired) {
                        if (!has(createAllow, requiredPath)) {
                            tasksPolicyErrors.push(`${profileBlockName}.${profileId}: TASK_SETTER_AGENT create_allow MUST include "${requiredPath}"`);
                        }
                    }
                    for (const forbiddenPath of createAllowTaskSetterForbidden) {
                        if (has(createAllow, forbiddenPath)) {
                            tasksPolicyErrors.push(`${profileBlockName}.${profileId}: TASK_SETTER_AGENT create_allow MUST NOT include "${forbiddenPath}"`);
                        }
                    }
                }
            }
        }

        if (tasksPolicyErrors.length > 0) {
            console.error(`❌ Error: ${profileBlockName} violate tasks orchestration policy:`);
            for (const err of tasksPolicyErrors) {
                console.error(`  - ${err}`);
            }
            process.exit(1);
        }
    }

    console.log('✅ Contract validated');
    console.log(`🛡️  Effective guards: ${effectiveGuards.guards.length} (global refs: ${effectiveGuards.globalGuardRefs.length}; layers: ${effectiveGuards.layersUsed.join(', ')})`);
    return effectiveGuards;
}

// === DRIFT CHECK ===
function checkTemplateDrift(contract: Contract): void {
    console.log('\n🔍 Checking template drift against contract...');

    // Collect all FRIDA_TPL_* blocks from contract
    const templateBlocks = Object.keys(contract).filter(k => k.startsWith('FRIDA_TPL_'));

    let passed = 0;
    let skipped = 0;
    for (const key of templateBlocks) {
        const block = contract[key];
        if (!block?.file) {
            console.warn(`⚠️  Missing 'file' in ${key} (skipped)`);
            skipped++;
            continue;
        }

        const filePath = path.join(ROOT_DIR, block.file);
        if (!fs.existsSync(filePath)) {
            console.error(`❌ Template drift: ${block.file} missing from repo`);
            console.error(`   Expected by contract block ${key}`);
            process.exit(1);
        }

        // Hash-based drift check: compare SHA-256 of .hbs file against contract content_hash
        const expectedHash = block.content_hash;
        if (!expectedHash) {
            // Fallback: if no content_hash, skip (older blocks still using inline content)
            console.warn(`⚠️  ${key} has no content_hash (skipped drift check)`);
            skipped++;
            continue;
        }

        const fileBytes = fs.readFileSync(filePath);
        const actualHash = 'sha256:' + crypto.createHash('sha256').update(fileBytes).digest('hex');

        if (actualHash !== expectedHash) {
            console.error(`❌ Template drift: ${block.file} hash mismatch`);
            console.error(`   Contract:  ${expectedHash}`);
            console.error(`   Actual: ${actualHash}`);
            console.error(`   Run 'npm run frida:hash' to see details.`);
            process.exit(1);
        }
        passed++;
    }

    console.log(`✅ Template drift check: ${passed} passed, ${skipped} skipped`);
}

function isZoneDefinition(value: unknown): value is Record<string, any> {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const zoneData = value as Record<string, any>;
    return typeof zoneData.pathGlobRef === 'string' || typeof zoneData.path === 'string';
}

function getZoneEntries(contract: Contract): Array<[string, any]> {
    return Object.entries(getZoneBlock(contract)).filter(([, value]) => isZoneDefinition(value));
}

// === DATA EXTRACTORS ===
function extractZones(contract: Contract): Zone[] {
    const zoneBlockName = getZoneBlockName();
    if (!contract[zoneBlockName]) return [];

    return getZoneEntries(contract).map(([id, data]: [string, any]) => ({
        id,
        name: formatZoneName(id),
        path:
            resolveRefValue(contract, data.path, `${zoneBlockName}.${id}.path`) ||
            resolveRefValue(contract, data.pathGlobRef, `${zoneBlockName}.${id}.pathGlobRef`) ||
            '',
        is_component: data.is_component,
        owner: data.owner,
        readOnly: data.readOnly ?? false,
        whyReadOnly: data.whyReadOnly,
        consequence: data.consequence,
        redirectPath:
            resolveRefValue(contract, data.redirectPath, `${zoneBlockName}.${id}.redirectPath`) ||
            resolveRefValue(contract, data.redirectPathDirRef, `${zoneBlockName}.${id}.redirectPathDirRef`) ||
            undefined,
        howToChange: data.howToChange,
        forbiddenOps: data.forbiddenOps,
        purpose: data.purpose,
        agentsPath:
            resolveRefValue(contract, data.agentsPath, `${zoneBlockName}.${id}.agentsPath`) ||
            resolveRefValue(contract, data.agentsPathDirRef, `${zoneBlockName}.${id}.agentsPathDirRef`) ||
            undefined,
        agentsTemplate: data.agentsTemplate,
        constraints: data.constraints,
        verification: data.verification,
        guardRefs: data.guardRefs,
        note: data.note,
        rules: data.rules,
        testRequirements: data.testRequirements,
    }));
}

function formatZoneName(id: string): string {
    return id
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

/**
 * Check if a zone is covered by an allowed path pattern
 */
function isZoneCovered(allowedPath: string, zonePath: string, agentsPath: string): boolean {
    const extractPrefix = (p: string) => p.replace(/\/?\*\*?.*$/, '').replace(/\/$/, '');

    const allowedPrefix = extractPrefix(allowedPath);
    const zonePrefix = extractPrefix(zonePath);
    const agentsPrefix = agentsPath.replace(/\/$/, '');

    // Zone path matches allowed (e.g., "src/services/**" covers "src/services/**")
    if (zonePrefix.startsWith(allowedPrefix) || allowedPrefix.startsWith(zonePrefix)) {
        return true;
    }

    // AGENTS.md path matches allowed (e.g., "scripts/mapper/**" covers "scripts/mapper/AGENTS.md")
    if (agentsPrefix.startsWith(allowedPrefix)) {
        return true;
    }

    // Subpath matches (e.g., "src/mount/feature/**" covers zone "src/mount/**")
    if (allowedPrefix.startsWith(zonePrefix + '/')) {
        return true;
    }

    return false;
}

function processProfile(
    id: string,
    data: any,
    contract: Contract,
    normalizer: PathNormalizer
): any {
    const profileBlockName = getProfileBlockName();
    const resolvedSecurity = resolveSecurity(contract, data.security || {}, `${profileBlockName}.${id}.security`);

    const normalizePaths = (paths: string[] | undefined): string[] => {
        if (!paths) return [];
        return paths.map(p => {
            const result = normalizer.normalize(p);
            if (result.deprecated) {
                console.warn(`⚠️  Profile ${id}: Deprecated path '${p}' → '${result.contractical}'`);
            }
            return result.contractical;
        });
    };

    // Collect all AGENTS.md paths for zones this profile works with
    const agentsMdPaths = new Set<string>();
    const allAllowedPaths = [
        ...resolvedSecurity.read_allow,
        ...resolvedSecurity.edit_allow
    ];

    for (const allowedPath of allAllowedPaths) {
        const zoneBlockName = getZoneBlockName();
        for (const [zoneId, zoneData] of getZoneEntries(contract)) {
            const resolvedZonePath =
                resolveRefValue(contract, zoneData.pathGlobRef, `${zoneBlockName}.${zoneId}.pathGlobRef`) ||
                resolveRefValue(contract, zoneData.path, `${zoneBlockName}.${zoneId}.path`) ||
                '';
            const resolvedAgentsPath =
                resolveRefValue(contract, zoneData.agentsPathDirRef, `${zoneBlockName}.${zoneId}.agentsPathDirRef`) ||
                resolveRefValue(contract, zoneData.agentsPath, `${zoneBlockName}.${zoneId}.agentsPath`) ||
                '';

            if (!resolvedZonePath || !resolvedAgentsPath) continue;

            if (isZoneCovered(allowedPath, resolvedZonePath, resolvedAgentsPath)) {
                agentsMdPaths.add(`${resolvedAgentsPath}/AGENTS.md`);
            }
        }
    }

    const normalizedReadAllow = normalizePaths(resolvedSecurity.read_allow);
    const normalizedAgentsPaths = Array.from(agentsMdPaths).map(p => normalizer.normalize(p).contractical);

    // Merge and dedupe
    const allReadAllow = [...normalizedReadAllow, ...normalizedAgentsPaths]
        .filter((v, i, a) => a.indexOf(v) === i);

    if (agentsMdPaths.size > 0) {
        console.log(`   📌 ${id}: Auto-added ${agentsMdPaths.size} AGENTS.md paths`);
    }

    const normalizeRedirects = (redirects: any[] | undefined): any[] => {
        if (!Array.isArray(redirects)) return [];

        const normalized: any[] = [];
        for (let i = 0; i < redirects.length; i++) {
            const r = redirects[i];
            if (!r || typeof r !== 'object') continue;

            const fromRaw = r.fromGlobRef ?? r.from;
            const toRaw = r.toFileRef ?? r.toDirRef ?? r.to;
            const from = resolveRefValue(contract, fromRaw, `${profileBlockName}.${id}.security.redirects[${i}].from`);
            const to = resolveRefValue(contract, toRaw, `${profileBlockName}.${id}.security.redirects[${i}].to`);
            const reason = typeof r.reason === 'string' ? r.reason : '';

            if (!from || !to || !reason) {
                console.warn(`⚠️  Profile ${id}: skipping invalid redirect at index ${i}`);
                continue;
            }

            const redirect: any = { from, to, reason };
            if (typeof r.guide === 'string' && r.guide.trim()) {
                redirect.guide = r.guide;
            }
            normalized.push(redirect);
        }
        return normalized;
    };

    const security = {
        read_allow: allReadAllow,
        edit_allow: normalizePaths(resolvedSecurity.edit_allow),
        create_allow: normalizePaths(resolvedSecurity.create_allow),
        forbid: normalizePaths(resolvedSecurity.forbid),
        edit_forbid: normalizePaths(resolvedSecurity.edit_forbid),
        forbiddenAction: data.security?.forbiddenAction || 'REDIRECT',
        redirects: normalizeRedirects(data.security?.redirects || data.redirects),
    };

    const resolvedInvariants = (data.invariants || []).map((invId: string) => {
        const inv = contract.INVARIANTS?.[invId];
        if (!inv) {
            console.warn(`⚠️  Profile ${id}: Unknown invariant '${invId}'`);
            return { id: invId, text: `UNKNOWN: ${invId}` };
        }
        return { id: inv.id || invId, text: inv.text };
    });

    return {
        id,
        ...data,
        keywords: Array.isArray(data.keywords) ? data.keywords.join(', ') : data.keywords,
        security,
        resolvedInvariants,
        contexts: data.contexts || null,
    };
}

// === ZONE AGENTS.MD GENERATOR ===
function generateZoneAgents(
    zones: Zone[],
    effectiveGuards: EffectiveGuards,
    docsTplRoot: string,
    bootloaderFilePath: string
): void {
    console.log('\n📋 Generating zone-specific AGENTS.md...\n');

    const templates: Record<string, HandlebarsTemplateDelegate> = {};

    const loadZoneTemplate = (name: string): HandlebarsTemplateDelegate => {
        if (!templates[name]) {
            const templateFile = `agents-${name}.hbs`;
            templates[name] = loadTemplate(docsTplRoot, templateFile);
        }
        return templates[name];
    };

    // Pre-load common templates
    templates['readonly-zone'] = loadTemplate(docsTplRoot, 'agents-readonly.hbs');
    templates['readonly'] = templates['readonly-zone'];
    templates['mapper'] = loadTemplate(docsTplRoot, 'agents-mapper.hbs');
    templates['no-touch'] = loadTemplate(docsTplRoot, 'agents-notouch.hbs');
    templates['notouch'] = templates['no-touch'];
    templates['service-layer'] = loadTemplate(docsTplRoot, 'agents-service.hbs');
    templates['service'] = templates['service-layer'];

    for (const zone of zones) {
        if (!zone.agentsPath) continue;

        const outputPath = path.join(ROOT_DIR, zone.agentsPath, 'AGENTS.md');
        if (path.resolve(outputPath) === path.resolve(bootloaderFilePath)) {
            console.log(`⏭️  Skipped zone AGENTS overwrite for bootloader path: ${path.relative(ROOT_DIR, outputPath)}`);
            continue;
        }
        const templateName = zone.agentsTemplate || (zone.readOnly ? 'readonly-zone' : 'mapper');
        const template = loadZoneTemplate(templateName);

        // Resolve guardRefs to full guard objects for template
        const resolvedGuards = (zone.guardRefs || [])
            .map(ref => effectiveGuards.guardById.get(ref))
            .filter(Boolean);

        let context: any;

        switch (templateName) {
            case 'readonly-zone':
            case 'readonly':
                context = {
                    zoneName: zone.name || formatZoneName(zone.id),
                    forbiddenOps: zone.forbiddenOps || ['any modifications'],
                    whyReadOnly: zone.whyReadOnly || 'Read-only zone',
                    consequence: zone.consequence || 'Changes may be lost',
                    howToChange: zone.howToChange ||
                        (zone.redirectPath ? `Edit ${zone.redirectPath} instead` : 'Follow designated process'),
                    guards: resolvedGuards,
                };
                break;

            case 'mapper':
                context = {
                    zoneName: zone.name || formatZoneName(zone.id),
                    purpose: zone.purpose || 'Editable zone',
                    constraints: zone.constraints || [],
                    verification: zone.verification || 'npm run verify',
                    guards: resolvedGuards,
                };
                break;

            case 'no-touch':
            case 'notouch':
                context = {
                    zoneName: zone.name || formatZoneName(zone.id),
                    whyReadOnly: zone.whyReadOnly || 'External sync process',
                    guards: resolvedGuards,
                };
                break;

            case 'service-layer':
            case 'service':
                context = {
                    zoneName: zone.name || formatZoneName(zone.id),
                    purpose: zone.purpose || 'Service layer',
                    constraints: zone.constraints || [],
                    verification: zone.verification || 'npm run verify',
                    rules: zone.rules || [],
                    testRequirements: zone.testRequirements || [
                        'Service functions must have tests',
                        'Test success and error cases',
                        'Mock external dependencies',
                    ],
                    guards: resolvedGuards,
                };
                break;

            default:
                context = { zone, guards: resolvedGuards };
        }

        write(outputPath, template(context), true);
    }
}

// === MAIN ===
export async function runFridaArtifactGenerator(options: LegacyGeneratorOptions = {}): Promise<void> {
    ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());

    console.log('🤖 FRIDA v3.0 GENERATOR\n');
    console.log('━'.repeat(60));
    console.log('Generating agent context from contract');
    console.log('━'.repeat(60) + '\n');

    registerHelpers();

    // Load and validate contract
    console.log('📚 Loading contract...');
    const loaded = loadGeneratorContext();
    const contract = normalizeContractForGenerator(loaded.contract);
    const { contractRaw, runtimePaths } = loaded;
    console.log(`📄 Contract artifact: ${path.relative(ROOT_DIR, runtimePaths.contractArtifactPath)}`);
    const effectiveGuards = validateContract(contract);
    checkTemplateDrift(contract);

    // Initialize path normalizer
    const normalizer = new PathNormalizer(contract.PATHS);
    console.log(`🔧 Path normalizer: ${normalizer.getCount()} mappings`);

    // Extract zones from contract
    const zones = extractZones(contract);
    console.log(`📍 Loaded ${zones.length} zones from contract`);

    // Resolve generator IO locations from FRIDA_CONFIG + PATHS refs.
    const fridaTplRoot = runtimePaths.templatesFridaDir;
    const docsTplRoot = runtimePaths.templatesDocsDir;

    console.log(`📂 Templates: Frida=${path.relative(ROOT_DIR, fridaTplRoot)}, Docs=${path.relative(ROOT_DIR, docsTplRoot)}`);

    // Process profiles
    console.log('\n📋 Processing profiles...\n');
    const profiles = getProfileEntries(contract).map(([id, data]) =>
        processProfile(id, data, contract, normalizer)
    );
    console.log(`✅ Processed ${profiles.length} profiles`);

    // Build and emit machine-readable IR artifacts to canonical `.frida/contract/artifacts` (via PATHS).
    console.log('\n📋 Generating internal IR artifacts...\n');
    const irPath = resolveArtifactFilePath(
        contract,
        [
            'PATHS.frida.contract.artifacts.irFile',
            'PATHS.fridaContract.irFile',
            'PATHS.frida.ir',
        ],
        path.relative(ROOT_DIR, path.join(runtimePaths.fridaInternalDir, 'frida.ir.json'))
    );
    const permissionsPath = resolveArtifactFilePath(
        contract,
        [
            'PATHS.frida.contract.artifacts.permissionsFile',
            'PATHS.fridaContract.permissionsFile',
            'PATHS.frida.permissions',
        ],
        path.relative(ROOT_DIR, path.join(runtimePaths.fridaInternalDir, 'frida.permissions.json'))
    );
    const graphPath = resolveArtifactFilePath(
        contract,
        [
            'PATHS.frida.contract.artifacts.graphFile',
            'PATHS.fridaContract.graphFile',
            'PATHS.frida.graph',
        ],
        path.relative(ROOT_DIR, path.join(runtimePaths.fridaInternalDir, 'frida.graph.mmd'))
    );
    const ir = buildFridaIR(contract, contractRaw, zones, profiles, normalizer, effectiveGuards);
    emitMachineReadableExports(ir, zones, profiles, irPath, permissionsPath, graphPath);

    // Generate Bootloader
    console.log('\n📋 Generating core FRIDA files...\n');
    const tplBootloader = loadTemplate(fridaTplRoot, 'bootloader.hbs');
    const bootloaderContent = tplBootloader({
        generatedAt: resolveGeneratedAt(),
        profileCount: profiles.length,
        zoneCount: zones.length,
        profiles,
        repoScope: runtimePaths.repoScope,
        isFridaSelfRepo: runtimePaths.repoScope === 'frida_repo',
        auditPlaybookPath: runtimePaths.auditPlaybookPath,
        auditCoreContractPath: runtimePaths.auditCoreContractPath,
        auditAppContractPath: runtimePaths.auditAppContractPath,
    });
    write(runtimePaths.bootloaderFilePath, bootloaderContent);

    // Generate Router
    const tplRouter = loadTemplate(fridaTplRoot, 'router.xml.hbs');
    const routeSets = [
        ...(Array.isArray(contract.FRIDA_INTERFACE_ROUTING?.routes) ? contract.FRIDA_INTERFACE_ROUTING.routes : []),
        ...(isEngineSelfRepo(ROOT_DIR) && Array.isArray(contract.FRIDA_INT_AGENT_ROUTING?.routes)
            ? contract.FRIDA_INT_AGENT_ROUTING.routes
            : []),
    ].map((route: any) => {
        const selectorPhrases = Array.isArray(route?.selector_phrases)
            ? route.selector_phrases.filter((value: unknown) => typeof value === 'string' && value.trim())
            : [];
        const allowedProfilesRaw = isEngineSelfRepo(ROOT_DIR)
            ? (Array.isArray(route?.allowed_profiles) ? route.allowed_profiles : route?.allowed_profiles?.frida_repo)
            : route?.allowed_profiles?.target_app_repo;
        const allowedProfiles = Array.isArray(allowedProfilesRaw) ? allowedProfilesRaw : [];
        return {
            id: route?.id || 'unknown',
            interface_ref: route?.interface_ref || '',
            intent_family: typeof route?.intent_family === 'string' ? route.intent_family : route?.id || 'unknown',
            phrases: selectorPhrases.join(', '),
            keywords: Array.isArray(route?.selector_keywords) ? route.selector_keywords.join(', ') : '',
            allowed_profiles: allowedProfiles.join(', '),
            context_profile: allowedProfiles[0] || profiles[0]?.id || '',
        };
    }).filter((route: any) => route.allowed_profiles.length > 0 && route.context_profile);
    write(path.join(runtimePaths.specsRootDir, 'ROUTER.xml'), tplRouter({ profiles, routes: routeSets }));

    // Generate Profiles
    const tplProfile = loadTemplate(fridaTplRoot, 'profile.xml.hbs');
    for (const profile of profiles) {
        write(path.join(runtimePaths.profilesRootDir, `${profile.id}.xml`), tplProfile(profile));
    }

    // Generate Zone AGENTS.md
    generateZoneAgents(zones, effectiveGuards, docsTplRoot, runtimePaths.bootloaderFilePath);

    // Generate core policy docs
    console.log('\n📋 Generating policy documentation...\n');

    const readOnlyZones = zones
        .filter(z => z.readOnly)
        .map(z => ({
            name: z.name || formatZoneName(z.id),
            path: z.path,
            whyReadOnly: z.whyReadOnly || 'Not specified',
            consequence: z.consequence || 'Changes may be lost',
            howToChange: z.howToChange ||
                (z.redirectPath ? `Update through ${z.redirectPath}` : 'Follow designated process'),
        }));

    const tplImmutability = loadTemplate(docsTplRoot, 'immutability.hbs');
    write(
        path.join(runtimePaths.docsPolicyDir, 'IMMUTABILITY.md'),
        tplImmutability({ readOnlyZones }),
        true
    );

    const tplBoundaries = loadTemplate(docsTplRoot, 'boundaries.hbs');
    const enforcedGuards = effectiveGuards.guards.filter(guard => guard.enforcement);
    write(
        path.join(runtimePaths.docsPolicyDir, 'BOUNDARIES.md'),
        tplBoundaries({ zones, enforcedGuards }),
        true
    );

    // Generate RUN_REPORTING.md from FRIDA_RUN_REPORTING
    let runReportingGenerated = false;
    const runReportingBlock = contract['FRIDA_RUN_REPORTING'];
    if (runReportingBlock) {
        const yamlContent = yaml.stringify(runReportingBlock, { indent: 2 });
        const content = `# Run Reporting Policy

This document defines the mandatory FRIDA Run Report policy for agent task completion.

## Policy

- **Required on:** SUCCESS and HALTED states
- **Format:** YAML in markdown fenced code block
- **Guard:** \`contract.observability.run-report-required\`

## Schema Reference

\`\`\`yaml
${yamlContent}\`\`\`

## Usage

Agents MUST emit a FRIDA Run Report at the end of every task:

1. On **SUCCESS**: Include all modified/created/deleted files and verification results
2. On **HALT**: Include decision trace and recovery steps

See \`contract:FRIDA_RUN_REPORTING\` for full schema details.
`;
        write(path.join(runtimePaths.docsPolicyDir, 'RUN_REPORTING.md'), content, true);
        runReportingGenerated = true;
    }

    // Execute adapter-owned generators (app-specific docs/guards/selectors).
    let adapterPolicyDocs = 0;
    let adapterReferenceDocs = 0;
    if (options.adapter?.generate) {
        console.log('\n📋 Running extension generators...\n');
        const adapterResult = await options.adapter.generate({
            contract,
            runtimePaths,
            zones,
            profiles,
            effectiveGuards,
            utils: {
                loadTemplate,
                write,
                formatZoneName,
                resolveRefValue,
            },
        });
        if (adapterResult?.policyDocs && Number.isFinite(adapterResult.policyDocs)) {
            adapterPolicyDocs = adapterResult.policyDocs;
        }
        if (adapterResult?.referenceDocs && Number.isFinite(adapterResult.referenceDocs)) {
            adapterReferenceDocs = adapterResult.referenceDocs;
        }
    }

    emitCanonicalMirrors(contract, runtimePaths);

    // Summary
    const zoneAgentsCount = zones.filter(z => z.agentsPath).length;
    const policyDocsCount = 2 + (runReportingGenerated ? 1 : 0) + adapterPolicyDocs;

    console.log('\n' + '━'.repeat(60));
    console.log('✨ FRIDA v3.0 GENERATION COMPLETE\n');
    console.log('📊 Summary:');
    console.log(`   Profiles:        ${profiles.length}`);
    console.log(`   Zones:           ${zones.length}`);
    console.log(`   Zone AGENTS.md:  ${zoneAgentsCount}`);
    console.log(`   Policy Docs:     ${policyDocsCount}`);
    console.log(`   Reference Docs:  ${adapterReferenceDocs}`);
    console.log(`   Internal (.frida): 3`);
    console.log('\n✅ All artifacts generated from contract!');
    console.log('━'.repeat(60) + '\n');
}

async function main(): Promise<void> {
    await runFridaArtifactGenerator();
}

const isMainModule = process.argv[1] && (
    process.argv[1].endsWith('generator.ts') ||
    process.argv[1].endsWith('generator.js')
);

if (isMainModule) {
    main().catch(err => {
        console.error('❌ Fatal error:', err);
        process.exit(1);
    });
}
    const profileBlockName = getProfileBlockName();
