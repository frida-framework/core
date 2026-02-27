import crypto from 'node:crypto';
import path from 'node:path';

function isObjectLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

function parseSelector(selector) {
  return String(selector || '')
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
}

function joinObjectPath(base, key) {
  return base ? `${base}.${key}` : key;
}

function joinArrayPath(base, index) {
  return `${base}[${index}]`;
}

function isTypedRefKey(key, explicitKeys, wildcardSuffix) {
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

function resolveEdgeType(key, edgeTypes, fallbackType) {
  if (edgeTypes[key]) {
    return edgeTypes[key];
  }
  if (key.endsWith('Ref')) {
    const base = key.slice(0, -3);
    return base ? toSnakeCase(base) : fallbackType;
  }
  return fallbackType;
}

function extractLastIndex(pathValue) {
  const matches = [...String(pathValue || '').matchAll(/\[(\d+)\]/g)];
  if (matches.length === 0) {
    return null;
  }
  return Number(matches[matches.length - 1][1]);
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function resolvePathRef(pathsBlock, ref) {
  if (!pathsBlock || typeof pathsBlock !== 'object') {
    return null;
  }
  if (typeof ref !== 'string' || !ref.startsWith('PATHS.')) {
    return null;
  }

  let cursor = pathsBlock;
  for (const part of ref.slice('PATHS.'.length).split('.')) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  if (typeof cursor === 'string') {
    return cursor;
  }
  if (isObjectLike(cursor) && typeof cursor.contract === 'string') {
    return cursor.contract;
  }
  return null;
}

export function resolveVisualOverlayPath(contract) {
  const fromConfig = resolvePathRef(
    contract?.PATHS,
    contract?.FRIDA_CONFIG?.visual?.overlay_outputFileRef
  );
  if (fromConfig) {
    return fromConfig;
  }
  if (typeof contract?.PATHS?.frida?.visualOverlayFile === 'string') {
    return contract.PATHS.frida.visualOverlayFile;
  }
  return '.frida/visual-schema.overlay.json';
}

export function resolveVisualDiffPreviewPath(contract) {
  const fromConfig = resolvePathRef(
    contract?.PATHS,
    contract?.FRIDA_CONFIG?.visual?.diff_previewFileRef
  );
  if (fromConfig) {
    return fromConfig;
  }
  if (typeof contract?.PATHS?.temp?.visualDiffPreviewFile === 'string') {
    return contract.PATHS.temp.visualDiffPreviewFile;
  }
  return '.temp/visual-diff.preview.json';
}

export function matchSelector(root, selector) {
  const segments = parseSelector(selector);
  const matches = [];

  const walk = (node, currentPath, index) => {
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

function collectTypedReferenceEdges(node, nodePath, out, config) {
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

function normalizeNode(node, selectorIndex) {
  return {
    id: node.id,
    nodeType: node.nodeType,
    path: node.path,
    selector: node.selector,
    selectorIndex,
  };
}

export function extractVisualSchemaOverlay(contract, contractRaw, options = {}) {
  const visualSchema = contract?.VISUAL_SCHEMA;
  if (!isObjectLike(visualSchema)) {
    throw new Error('contract VISUAL_SCHEMA is missing or invalid.');
  }

  const mappingNodes = Array.isArray(visualSchema?.mapping?.nodes)
    ? visualSchema.mapping.nodes
    : [];
  const edgeSources = Array.isArray(visualSchema?.mapping?.edge_sources)
    ? visualSchema.mapping.edge_sources
    : [];

  const explicitKeys = new Set(
    Array.isArray(visualSchema?.edge_extraction?.typed_references?.explicit_keys)
      ? visualSchema.edge_extraction.typed_references.explicit_keys
      : []
  );

  const edgeTypes = isObjectLike(visualSchema?.edge_extraction?.typed_references?.edge_types)
    ? visualSchema.edge_extraction.typed_references.edge_types
    : {};
  const wildcardSuffix = visualSchema?.edge_extraction?.typed_references?.wildcard_suffix || '*Ref';
  const fallbackType = edgeTypes.fallback_ref_suffix || 'ref';

  const nodeById = new Map();
  const nodeIdByPath = new Map();
  const normalizedNodes = [];

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
      const normalized = normalizeNode(
        {
          id: nodeId,
          nodeType: rule.nodeType || 'node',
          path: match.path,
          selector: rule.selector,
        },
        selectorIndex
      );
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

  const typedEdges = [];
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

  const sequenceEdges = [];
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

  const edgeById = new Map();
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
      contractSha256: sha256(contractRaw),
      visualSchemaVersion: visualSchema.version || null,
      source: path.posix.join('contract', 'contract.index.yaml'),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
    lod: visualSchema.lod || {},
    nodes,
    edges,
  };
}

export function normalizeOverlayForComparison(overlay) {
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
