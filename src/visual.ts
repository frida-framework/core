import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { loadCanonDocument } from './canon-path.ts';

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

function isTypedRefsKey(key: string, explicitKeys: Set<string>, wildcardSuffix: string): boolean {
    if (explicitKeys.has(key)) {
        return true;
    }
    if (wildcardSuffix === '*Refs') {
        return key.endsWith('Refs');
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
    if (key.endsWith('Refs')) {
        const base = key.slice(0, -4);
        return base ? toSnakeCase(base) : fallbackType;
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
        listWildcardSuffix: string;
        edgeTypes: AnyObject;
        fallbackType: string;
        fallbackListType: string;
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
            if (isTypedRefsKey(key, config.explicitKeys, config.listWildcardSuffix)) {
                for (const listValue of value) {
                    if (typeof listValue !== 'string') {
                        continue;
                    }
                    const targetRef = listValue.trim();
                    if (!targetRef) {
                        continue;
                    }
                    out.push({
                        sourceKind: 'typed_ref',
                        sourcePath: nodePath,
                        sourceKey: key,
                        edgeType: resolveEdgeType(key, config.edgeTypes, config.fallbackListType),
                        targetRef,
                    });
                }
            }
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

function assertVisualContractConsistency(raw: string, contract: AnyObject): void {
    const issues: string[] = [];

    const hasRef = (ref: string) => raw.includes(ref);

    if (!isObjectLike(contract.VISUAL_SCHEMA)) {
        issues.push('VISUAL_SCHEMA block is missing or invalid.');
    } else if (typeof contract.VISUAL_SCHEMA.version !== 'string' || !contract.VISUAL_SCHEMA.version.trim()) {
        issues.push('VISUAL_SCHEMA.version must be a non-empty string.');
    }

    if (hasRef('contract:VISUAL_SCHEMA') && !isObjectLike(contract.VISUAL_SCHEMA)) {
        issues.push('Referenced contract:VISUAL_SCHEMA but VISUAL_SCHEMA block is missing.');
    }

    if (issues.length > 0) {
        throw new Error(`Visual contract consistency failed: ${issues.join(' | ')}`);
    }
}

export function extractVisualSchemaOverlay(
    contract: AnyObject,
    contractRaw: string,
    options: { generatedAt?: string; sourcePath?: string } = {}
): OverlayResult {
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
    const listWildcardSuffix = visualSchema?.edge_extraction?.typed_references?.list_wildcard_suffix || '*Refs';
    const fallbackType = edgeTypes.fallback_ref_suffix || 'ref';
    const fallbackListType = edgeTypes.fallback_refs_suffix || fallbackType;

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
                listWildcardSuffix,
                edgeTypes,
                fallbackType,
                fallbackListType,
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
            source: options.sourcePath || path.posix.join('contract', 'canon.cbmd.yaml'),
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
    canonPath: string | null;
    outputPath: string | null;
    stdout: boolean;
    dryRun: boolean;
} {
    const action = args.includes('--check') ? 'check' : 'build';

    const readFlag = (flag: string): string | null => {
        const idx = args.indexOf(flag);
        if (idx === -1 || idx + 1 >= args.length) {
            return null;
        }
        return args[idx + 1];
    };

    return {
        action,
        canonPath: readFlag('--canon'),
        outputPath: readFlag('--out'),
        stdout: args.includes('--stdout'),
        dryRun: args.includes('--dry-run'),
    };
}

function loadContract(rootDir: string, canonPath: string | null): { raw: string; contract: AnyObject; canonPath: string } {
    const loaded = loadCanonDocument(rootDir, canonPath || undefined);
    return { raw: loaded.raw, contract: loaded.parsed as AnyObject, canonPath: loaded.canonPath };
}

function runVisualBuild(rootDir: string, parsedArgs: ReturnType<typeof parseVisualArgs>): number {
    const { raw, contract, canonPath } = loadContract(rootDir, parsedArgs.canonPath);
    assertVisualContractConsistency(raw, contract);
    const overlay = extractVisualSchemaOverlay(contract, raw, {
        sourcePath: path.relative(rootDir, canonPath).replace(/\\/g, '/'),
    });

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
    const { raw, contract, canonPath } = loadContract(rootDir, parsedArgs.canonPath);
    assertVisualContractConsistency(raw, contract);

    const sourcePath = path.relative(rootDir, canonPath).replace(/\\/g, '/');
    const first = extractVisualSchemaOverlay(contract, raw, { generatedAt: FIXED_TIMESTAMP, sourcePath });
    const second = extractVisualSchemaOverlay(contract, raw, { generatedAt: FIXED_TIMESTAMP, sourcePath });
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
