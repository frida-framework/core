import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const DEFAULT_CANON_PATH = 'contract/canon.cbmd.yaml';
const FIXED_TIMESTAMP = '1970-01-01T00:00:00.000Z';

type AnyObject = Record<string, any>;

interface SelectorMatch {
    path: string;
    value: unknown;
}

interface OverlayNode {
    id: string;
    nodeType: string;
    path: string;
    selector: string;
}

interface OverlayEdge {
    id: string;
    sourceKind: 'typed_ref' | 'sequence';
    sourcePath: string;
    sourceNode: string | null;
    sourceKey: string;
    edgeType: string;
    targetRef: string;
    targetNode: string | null;
}

interface OverlayResult {
    meta: {
        generatedAt: string;
        canonSha256: string;
        visualSchemaVersion: string | null;
        source: string;
        nodeCount: number;
        edgeCount: number;
    };
    lod: Record<string, unknown>;
    nodes: OverlayNode[];
    edges: OverlayEdge[];
}

function isObjectLike(value: unknown): value is AnyObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSnakeCase(value: string): string {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/-/g, '_')
        .toLowerCase();
}

function parseSelector(selector: string): string[] {
    return String(selector || '')
        .split('.')
        .map((part) => part.trim())
        .filter(Boolean);
}

function joinObjectPath(base: string, key: string): string {
    return base ? `${base}.${key}` : key;
}

function joinArrayPath(base: string, index: number): string {
    return `${base}[${index}]`;
}

function isTypedRefKey(key: string, explicitKeys: Set<string>, wildcardSuffix: string): boolean {
    if (explicitKeys.has(key)) {
        return true;
    }
    if (wildcardSuffix === '*Ref') {
        return key.endsWith('Ref');
    }
    if (wildcardSuffix.startsWith('*')) {
        return key.endsWith(wildcardSuffix.slice(1));
    }
    return key === wildcardSuffix;
}

function resolveEdgeType(key: string, edgeTypes: AnyObject, fallbackType: string): string {
    if (typeof edgeTypes[key] === 'string') {
        return edgeTypes[key];
    }
    if (key.endsWith('Ref')) {
        const base = key.slice(0, -3);
        return base ? toSnakeCase(base) : fallbackType;
    }
    return fallbackType;
}

function extractLastIndex(pathValue: string): number | null {
    const matches = [...String(pathValue || '').matchAll(/\[(\d+)\]/g)];
    if (matches.length === 0) {
        return null;
    }
    return Number(matches[matches.length - 1][1]);
}

function sha256(text: string): string {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolvePathRef(pathsBlock: AnyObject, ref: string): string | null {
    if (!pathsBlock || typeof pathsBlock !== 'object') {
        return null;
    }
    if (typeof ref !== 'string' || !ref.startsWith('PATHS.')) {
        return null;
    }

    let cursor: unknown = pathsBlock;
    for (const part of ref.slice('PATHS.'.length).split('.')) {
        if (!isObjectLike(cursor) || !(part in cursor)) {
            return null;
        }
        cursor = cursor[part];
    }

    if (typeof cursor === 'string') {
        return cursor;
    }
    if (isObjectLike(cursor) && typeof cursor.canonical === 'string') {
        return cursor.canonical;
    }
    return null;
}

export function resolveVisualOverlayPath(contract: AnyObject): string {
    const fromConfig = resolvePathRef(contract?.PATHS, contract?.FRIDA_CONFIG?.visual?.overlay_outputFileRef);
    if (fromConfig) {
        return fromConfig;
    }
    if (typeof contract?.PATHS?.frida?.visualOverlayFile === 'string') {
        return contract.PATHS.frida.visualOverlayFile;
    }
    return '.frida/visual-schema.overlay.json';
}

export function resolveVisualDiffPreviewPath(contract: AnyObject): string {
    const fromConfig = resolvePathRef(contract?.PATHS, contract?.FRIDA_CONFIG?.visual?.diff_previewFileRef);
    if (fromConfig) {
        return fromConfig;
    }
    if (typeof contract?.PATHS?.temp?.visualDiffPreviewFile === 'string') {
        return contract.PATHS.temp.visualDiffPreviewFile;
    }
    return '.temp/visual-diff.preview.json';
}

function matchSelector(root: AnyObject, selector: string): SelectorMatch[] {
    const segments = parseSelector(selector);
    const matches: SelectorMatch[] = [];

    const walk = (node: unknown, currentPath: string, index: number) => {
        if (index >= segments.length) {
            matches.push({ path: currentPath, value: node });
            return;
        }

        const token = segments[index];

        if (token === '*') {
            if (!isObjectLike(node)) return;
            for (const key of Object.keys(node).sort()) {
                walk(node[key], joinObjectPath(currentPath, key), index + 1);
            }
            return;
        }

        if (token === '[*]') {
            if (!Array.isArray(node)) return;
            for (let i = 0; i < node.length; i += 1) {
                walk(node[i], joinArrayPath(currentPath, i), index + 1);
            }
            return;
        }

        if (token.endsWith('[*]')) {
            const key = token.slice(0, -3);
            if (key) {
                if (!isObjectLike(node) || !(key in node) || !Array.isArray(node[key])) return;
                const arrayPath = joinObjectPath(currentPath, key);
                for (let i = 0; i < node[key].length; i += 1) {
                    walk(node[key][i], joinArrayPath(arrayPath, i), index + 1);
                }
            } else if (Array.isArray(node)) {
                for (let i = 0; i < node.length; i += 1) {
                    walk(node[i], joinArrayPath(currentPath, i), index + 1);
                }
            }
            return;
        }

        if (!isObjectLike(node) || !(token in node)) {
            return;
        }

        walk(node[token], joinObjectPath(currentPath, token), index + 1);
    };

    walk(root, '', 0);
    matches.sort((a, b) => a.path.localeCompare(b.path));
    return matches;
}

function collectTypedReferenceEdges(
    node: unknown,
    nodePath: string,
    out: Array<{ sourceKind: 'typed_ref'; sourcePath: string; sourceKey: string; edgeType: string; targetRef: string }>,
    config: {
        explicitKeys: Set<string>;
        wildcardSuffix: string;
        edgeTypes: AnyObject;
        fallbackType: string;
    }
): void {
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i += 1) {
            collectTypedReferenceEdges(node[i], joinArrayPath(nodePath, i), out, config);
        }
        return;
    }

    if (!isObjectLike(node)) {
        return;
    }

    for (const key of Object.keys(node).sort()) {
        const value = node[key];
        const childPath = joinObjectPath(nodePath, key);

        if (typeof value === 'string') {
            if (!isTypedRefKey(key, config.explicitKeys, config.wildcardSuffix)) {
                continue;
            }
            const targetRef = value.trim();
            if (!targetRef) {
                continue;
            }
            out.push({
                sourceKind: 'typed_ref',
                sourcePath: nodePath,
                sourceKey: key,
                edgeType: resolveEdgeType(key, config.edgeTypes, config.fallbackType),
                targetRef,
            });
            continue;
        }

        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i += 1) {
                collectTypedReferenceEdges(value[i], joinArrayPath(childPath, i), out, config);
            }
            continue;
        }

        if (isObjectLike(value)) {
            collectTypedReferenceEdges(value, childPath, out, config);
        }
    }
}

function assertVisualSchemaContract(contract: AnyObject): void {
    if (!isObjectLike(contract?.VISUAL_SCHEMA)) {
        throw new Error('contract VISUAL_SCHEMA is missing or invalid.');
    }
    if (typeof contract.VISUAL_SCHEMA.version !== 'string' || !contract.VISUAL_SCHEMA.version.trim()) {
        throw new Error('contract VISUAL_SCHEMA.version must be a non-empty string.');
    }
}

function assertVisualDiffContract(contract: AnyObject): void {
    if (!isObjectLike(contract?.VISUAL_DIFF)) {
        throw new Error('contract VISUAL_DIFF is missing or invalid.');
    }
    const operations = contract.VISUAL_DIFF.operations;
    if (!isObjectLike(operations)) {
        throw new Error('contract VISUAL_DIFF.operations is missing or invalid.');
    }
    if (!Array.isArray(operations.allowedKinds) || operations.allowedKinds.length === 0) {
        throw new Error('contract VISUAL_DIFF.operations.allowedKinds must be a non-empty array.');
    }
    if (!Array.isArray(operations.allowedEntities) || operations.allowedEntities.length === 0) {
        throw new Error('contract VISUAL_DIFF.operations.allowedEntities must be a non-empty array.');
    }
}

function assertVisualContractConsistency(raw: string, contract: AnyObject): void {
    const issues: string[] = [];

    const hasRef = (ref: string) => raw.includes(ref);

    if (hasRef('contract:VISUAL_SCHEMA') && !isObjectLike(contract.VISUAL_SCHEMA)) {
        issues.push('Referenced contract:VISUAL_SCHEMA but VISUAL_SCHEMA block is missing.');
    }
    if (hasRef('contract:VISUAL_DIFF') && !isObjectLike(contract.VISUAL_DIFF)) {
        issues.push('Referenced contract:VISUAL_DIFF but VISUAL_DIFF block is missing.');
    }
    if (hasRef('contract:ARCHCHAT_CONTEXT') && !isObjectLike(contract.ARCHCHAT_CONTEXT)) {
        issues.push('Referenced contract:ARCHCHAT_CONTEXT but ARCHCHAT_CONTEXT block is missing.');
    }
    if (hasRef('contract:VALIDATION_RULES_FRIDA.repoGuards')) {
        if (!isObjectLike(contract.VALIDATION_RULES_FRIDA) || !Array.isArray(contract.VALIDATION_RULES_FRIDA.repoGuards)) {
            issues.push('Referenced contract:VALIDATION_RULES_FRIDA.repoGuards but it is missing or invalid.');
        }
    }
    if (hasRef('contract:VALIDATION_RULES_FRIDA.visualGuards')) {
        if (!isObjectLike(contract.VALIDATION_RULES_FRIDA) || !Array.isArray(contract.VALIDATION_RULES_FRIDA.visualGuards)) {
            issues.push('Referenced contract:VALIDATION_RULES_FRIDA.visualGuards but it is missing or invalid.');
        }
    }

    if (issues.length > 0) {
        throw new Error(`Visual contract consistency failed: ${issues.join(' | ')}`);
    }
}

export function extractVisualSchemaOverlay(contract: AnyObject, contractRaw: string, options: { generatedAt?: string } = {}): OverlayResult {
    assertVisualSchemaContract(contract);
    const visualSchema = contract.VISUAL_SCHEMA;

    const mappingNodes = Array.isArray(visualSchema?.mapping?.nodes)
        ? visualSchema.mapping.nodes
        : [];
    const edgeSources = Array.isArray(visualSchema?.mapping?.edge_sources)
        ? visualSchema.mapping.edge_sources
        : [];

    const explicitKeys = new Set<string>(
        Array.isArray(visualSchema?.edge_extraction?.typed_references?.explicit_keys)
            ? visualSchema.edge_extraction.typed_references.explicit_keys
            : []
    );

    const edgeTypes = isObjectLike(visualSchema?.edge_extraction?.typed_references?.edge_types)
        ? visualSchema.edge_extraction.typed_references.edge_types
        : {};
    const wildcardSuffix = visualSchema?.edge_extraction?.typed_references?.wildcard_suffix || '*Ref';
    const fallbackType = edgeTypes.fallback_ref_suffix || 'ref';

    const nodeById = new Map<string, OverlayNode & { selectorIndex: number }>();
    const nodeIdByPath = new Map<string, string>();
    const normalizedNodes: Array<OverlayNode & { selectorIndex: number }> = [];

    for (let selectorIndex = 0; selectorIndex < mappingNodes.length; selectorIndex += 1) {
        const rule = mappingNodes[selectorIndex];
        if (!isObjectLike(rule) || typeof rule.selector !== 'string') {
            continue;
        }
        const selectorMatches = matchSelector(contract, rule.selector);
        for (const match of selectorMatches) {
            const idTemplate = typeof rule.idTemplate === 'string' ? rule.idTemplate : '{path}';
            const nodeId = idTemplate.replace('{path}', match.path);
            if (nodeById.has(nodeId)) {
                continue;
            }
            const normalized = {
                id: nodeId,
                nodeType: rule.nodeType || 'node',
                path: match.path,
                selector: rule.selector,
                selectorIndex,
            };
            nodeById.set(nodeId, normalized);
            if (!nodeIdByPath.has(match.path)) {
                nodeIdByPath.set(match.path, nodeId);
            }
            normalizedNodes.push(normalized);
        }
    }

    normalizedNodes.sort((a, b) => {
        if (a.selectorIndex !== b.selectorIndex) {
            return a.selectorIndex - b.selectorIndex;
        }
        return a.path.localeCompare(b.path);
    });

    const typedEdges: Array<{ sourceKind: 'typed_ref'; sourcePath: string; sourceKey: string; edgeType: string; targetRef: string }> = [];
    for (const sourceSelector of edgeSources) {
        const matches = matchSelector(contract, sourceSelector);
        for (const match of matches) {
            collectTypedReferenceEdges(match.value, match.path, typedEdges, {
                explicitKeys,
                wildcardSuffix,
                edgeTypes,
                fallbackType,
            });
        }
    }

    const sequenceEdges: Array<{ sourceKind: 'sequence'; sourcePath: string; sourceKey: string; edgeType: string; targetRef: string }> = [];
    const sequenceRules = Array.isArray(visualSchema?.edge_extraction?.deterministic_sequence?.rules)
        ? visualSchema.edge_extraction.deterministic_sequence.rules
        : [];

    for (const rule of sequenceRules) {
        if (!isObjectLike(rule) || typeof rule.selector !== 'string') {
            continue;
        }
        const edgeType = typeof rule.edgeType === 'string' ? rule.edgeType : 'next';
        const matches = matchSelector(contract, rule.selector).sort((a, b) => {
            const aIdx = extractLastIndex(a.path);
            const bIdx = extractLastIndex(b.path);
            if (aIdx !== null && bIdx !== null && aIdx !== bIdx) {
                return aIdx - bIdx;
            }
            return a.path.localeCompare(b.path);
        });

        for (let i = 0; i < matches.length - 1; i += 1) {
            const sourcePath = matches[i].path;
            const targetPath = matches[i + 1].path;
            if (!nodeIdByPath.has(sourcePath) || !nodeIdByPath.has(targetPath)) {
                continue;
            }
            sequenceEdges.push({
                sourceKind: 'sequence',
                sourcePath,
                sourceKey: 'index',
                edgeType,
                targetRef: targetPath,
            });
        }
    }

    const edgeById = new Map<string, OverlayEdge>();
    for (const edge of [...typedEdges, ...sequenceEdges]) {
        if (!edge.sourcePath || !edge.sourceKey || !edge.targetRef || !edge.edgeType) {
            continue;
        }
        const id = `${edge.sourcePath}|${edge.edgeType}|${edge.targetRef}|${edge.sourceKey}`;
        if (edgeById.has(id)) {
            continue;
        }
        edgeById.set(id, {
            id,
            sourceKind: edge.sourceKind,
            sourcePath: edge.sourcePath,
            sourceNode: nodeIdByPath.get(edge.sourcePath) || null,
            sourceKey: edge.sourceKey,
            edgeType: edge.edgeType,
            targetRef: edge.targetRef,
            targetNode: nodeIdByPath.get(edge.targetRef) || null,
        });
    }

    const edges = [...edgeById.values()].sort((a, b) => {
        if (a.sourcePath !== b.sourcePath) return a.sourcePath.localeCompare(b.sourcePath);
        if (a.sourceKey !== b.sourceKey) return a.sourceKey.localeCompare(b.sourceKey);
        if (a.edgeType !== b.edgeType) return a.edgeType.localeCompare(b.edgeType);
        return a.targetRef.localeCompare(b.targetRef);
    });

    const nodes = normalizedNodes.map(({ selectorIndex: _drop, ...node }) => node);
    const generatedAt = options.generatedAt || new Date().toISOString();

    return {
        meta: {
            generatedAt,
            canonSha256: sha256(contractRaw),
            visualSchemaVersion: visualSchema.version || null,
            source: path.posix.join('contract', 'canon.cbmd.yaml'),
            nodeCount: nodes.length,
            edgeCount: edges.length,
        },
        lod: visualSchema.lod || {},
        nodes,
        edges,
    };
}

export function normalizeOverlayForComparison(overlay: OverlayResult): OverlayResult {
    if (!isObjectLike(overlay)) {
        return overlay;
    }
    return {
        ...overlay,
        meta: {
            ...(overlay.meta || {}),
            generatedAt: '__fixed__',
        },
    };
}

function toAbsolutePath(rootDir: string, relativeOrAbsolute: string): string {
    if (path.isAbsolute(relativeOrAbsolute)) {
        return relativeOrAbsolute;
    }
    return path.join(rootDir, relativeOrAbsolute.replace(/^\.\//, '').replace(/^\/+/, ''));
}

function parseVisualArgs(args: string[]): {
    action: 'build' | 'check';
    canonPath: string;
    outputPath: string | null;
    stdout: boolean;
    dryRun: boolean;
    diffPathOverride: string | null;
} {
    const action = args[0] === 'check' ? 'check' : 'build';

    const readFlag = (flag: string): string | null => {
        const idx = args.indexOf(flag);
        if (idx === -1 || idx + 1 >= args.length) {
            return null;
        }
        return args[idx + 1];
    };

    return {
        action,
        canonPath: readFlag('--canon') || DEFAULT_CANON_PATH,
        outputPath: readFlag('--out'),
        stdout: args.includes('--stdout'),
        dryRun: args.includes('--dry-run'),
        diffPathOverride: readFlag('--diff'),
    };
}

function loadContract(rootDir: string, canonPath: string): { raw: string; contract: AnyObject } {
    const absCanonPath = toAbsolutePath(rootDir, canonPath);
    if (!fs.existsSync(absCanonPath)) {
        throw new Error(`Canon artifact not found: ${absCanonPath}`);
    }
    const raw = fs.readFileSync(absCanonPath, 'utf8');
    const contract = yaml.parse(raw) as AnyObject;
    if (!contract || typeof contract !== 'object') {
        throw new Error('Canon artifact parsed to empty or non-object value.');
    }
    return { raw, contract };
}

function validateDiffPayload(payload: AnyObject, contract: AnyObject): void {
    assertVisualDiffContract(contract);
    if (!isObjectLike(payload)) {
        throw new Error('Visual diff payload must be an object.');
    }
    if (typeof payload.baseCanonSha256 !== 'string' || typeof payload.draftCanonSha256 !== 'string') {
        throw new Error('Visual diff payload must include baseCanonSha256 and draftCanonSha256 strings.');
    }
    if (!Array.isArray(payload.operations)) {
        throw new Error('Visual diff payload operations must be an array.');
    }

    const allowedKinds = new Set(contract.VISUAL_DIFF.operations.allowedKinds);
    const allowedEntities = new Set(contract.VISUAL_DIFF.operations.allowedEntities);

    for (const [index, operation] of payload.operations.entries()) {
        if (!isObjectLike(operation)) {
            throw new Error(`operations[${index}] must be an object.`);
        }
        if (!allowedKinds.has(operation.kind)) {
            throw new Error(`operations[${index}].kind='${operation.kind}' is not allowed.`);
        }
        if (!allowedEntities.has(operation.entity)) {
            throw new Error(`operations[${index}].entity='${operation.entity}' is not allowed.`);
        }
    }
}

function runVisualBuild(rootDir: string, parsedArgs: ReturnType<typeof parseVisualArgs>): number {
    const { raw, contract } = loadContract(rootDir, parsedArgs.canonPath);
    assertVisualContractConsistency(raw, contract);
    const overlay = extractVisualSchemaOverlay(contract, raw);

    const outputRelative = parsedArgs.outputPath || resolveVisualOverlayPath(contract);
    const outputFilePath = toAbsolutePath(rootDir, outputRelative);
    if (!parsedArgs.dryRun) {
        fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
        fs.writeFileSync(outputFilePath, `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
    }

    console.log(
        `✅ Visual overlay extracted: nodes=${overlay.nodes.length}, edges=${overlay.edges.length}, out=${path.relative(
            rootDir,
            outputFilePath
        )}`
    );
    if (parsedArgs.stdout) {
        console.log(JSON.stringify(overlay, null, 2));
    }
    return 0;
}

function runVisualCheck(rootDir: string, parsedArgs: ReturnType<typeof parseVisualArgs>): number {
    const { raw, contract } = loadContract(rootDir, parsedArgs.canonPath);
    assertVisualContractConsistency(raw, contract);

    const first = extractVisualSchemaOverlay(contract, raw, { generatedAt: FIXED_TIMESTAMP });
    const second = extractVisualSchemaOverlay(contract, raw, { generatedAt: FIXED_TIMESTAMP });
    if (JSON.stringify(first) !== JSON.stringify(second)) {
        throw new Error('Visual schema extraction is not deterministic (same input produced different overlays).');
    }

    const overlayPath = toAbsolutePath(rootDir, resolveVisualOverlayPath(contract));
    if (fs.existsSync(overlayPath)) {
        const current = JSON.parse(fs.readFileSync(overlayPath, 'utf8'));
        const normalizedCurrent = normalizeOverlayForComparison(current);
        const normalizedExpected = normalizeOverlayForComparison(first);
        if (JSON.stringify(normalizedCurrent) !== JSON.stringify(normalizedExpected)) {
            throw new Error(
                `Visual overlay drift detected in ${path.relative(
                    rootDir,
                    overlayPath
                )}. Run 'frida-core visual build' to regenerate.`
            );
        }
    }

    const diffRelativePath = parsedArgs.diffPathOverride || resolveVisualDiffPreviewPath(contract);
    const diffPath = toAbsolutePath(rootDir, diffRelativePath);
    if (fs.existsSync(diffPath)) {
        const payload = JSON.parse(fs.readFileSync(diffPath, 'utf8'));
        validateDiffPayload(payload, contract);
        console.log(`✅ Visual diff schema OK (${payload.operations.length} operations)`);
    } else {
        console.warn(`⚠️  Visual diff preview file not found: ${path.relative(rootDir, diffPath)} (skip schema check).`);
    }

    console.log(`✅ VISUAL_SCHEMA deterministic extraction OK (nodes=${first.nodes.length}, edges=${first.edges.length})`);
    return 0;
}

export async function runFridaVisualCli(args: string[] = []): Promise<number> {
    try {
        const parsedArgs = parseVisualArgs(args);
        const rootDir = process.cwd();
        if (parsedArgs.action === 'check') {
            return runVisualCheck(rootDir, parsedArgs);
        }
        return runVisualBuild(rootDir, parsedArgs);
    } catch (error) {
        console.error(`❌ frida-core visual failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
