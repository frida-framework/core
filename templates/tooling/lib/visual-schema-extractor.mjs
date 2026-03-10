import crypto from 'node:crypto';
import path from 'node:path';

const FIXED_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const OVERLAY_SCHEMA_ID = 'frida-visual-overlay';
const OVERLAY_SCHEMA_VERSION = '1.0.0';
const OVERLAY_BUILDER_ENTRYPOINT = 'src/visual.ts';
const OVERLAY_BUILDER_COMMAND = 'frida-core visual';
const OVERLAY_PROJECTION_AUTHORITY = 'FRIDA_VISUAL.component_projection';
const CANONICAL_COMPONENT_SECTIONS = [
  'component_hierarchy_position',
  'component_mount_point',
  'component_input_interface',
  'component_output_interface',
  'component_domain_blocks',
  'component_shared_refs',
];
const REQUIRED_BOUNDARY_ESTABLISHMENT_ORDER = [
  'component_hierarchy_position',
  'component_mount_point',
  'component_input_interface',
  'component_output_interface',
];
const ALLOWED_MOUNT_KINDS = ['mapper-managed', 'host-static'];
const ALLOWED_EXIT_OUTCOMES = ['continue', 'return', 'exit'];
const SPECIFICATION_SECTION_IDS = {
  component_hierarchy_position: 'boundary_placement',
  component_mount_point: 'entry_boundary',
  component_input_interface: 'inbound_interface',
  component_output_interface: 'exit_semantics',
  component_domain_blocks: 'boundary_content',
  component_shared_refs: 'dependency_refs',
};

function isObjectLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function asPlainObject(value, label) {
  if (!isObjectLike(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function asStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`);
  }
  return value.map((entry) => {
    if (!isNonEmptyString(entry)) {
      throw new Error(`${label} must contain only non-empty strings.`);
    }
    return entry.trim();
  });
}

function stableObjectKeys(node) {
  return Object.keys(node).sort((a, b) => a.localeCompare(b));
}

function toIdSegment(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return normalized || 'root';
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function resolvePathRef(pathsBlock, ref) {
  if (!isObjectLike(pathsBlock) || !isNonEmptyString(ref) || !ref.startsWith('PATHS.')) {
    return null;
  }

  let cursor = { PATHS: pathsBlock };
  for (const part of ref.split('.')) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return isNonEmptyString(cursor) ? cursor.trim() : null;
}

export function resolveVisualOverlayPath(contract) {
  const fridaConfigVisual = isObjectLike(contract?.FRIDA_CONFIG) && isObjectLike(contract.FRIDA_CONFIG.visual)
    ? contract.FRIDA_CONFIG.visual
    : null;
  const fromConfig = resolvePathRef(
    contract?.PATHS,
    fridaConfigVisual?.overlay_pathRef || fridaConfigVisual?.overlay_outputFileRef
  );
  if (fromConfig) {
    return fromConfig;
  }
  const pathsVisual = isObjectLike(contract?.PATHS) && isObjectLike(contract.PATHS.visual)
    ? contract.PATHS.visual
    : null;
  if (isNonEmptyString(pathsVisual?.overlayFile)) {
    return pathsVisual.overlayFile.trim();
  }
  const pathsFridaContract = isObjectLike(contract?.PATHS) && isObjectLike(contract.PATHS.fridaContract)
    ? contract.PATHS.fridaContract
    : null;
  if (isNonEmptyString(pathsFridaContract?.visualOverlayFile)) {
    return pathsFridaContract.visualOverlayFile.trim();
  }
  return '.frida/contract/visual/canon-overlay.json';
}

function getPresentComponentSections(node) {
  return CANONICAL_COMPONENT_SECTIONS.filter((section) => section in node);
}

function assertRequiredSections(node, label) {
  const present = getPresentComponentSections(node);
  if (present.length === 0) {
    return;
  }
  if (present.length !== CANONICAL_COMPONENT_SECTIONS.length) {
    const missing = CANONICAL_COMPONENT_SECTIONS.filter((section) => !present.includes(section));
    throw new Error(`${label} is missing required component sections: ${missing.join(', ')}`);
  }
}

function deriveRootBoundaryId(contractPath) {
  const base = path.basename(contractPath).replace(/\.(ya?ml|json)$/i, '');
  if (base === 'contract.index') {
    return toIdSegment(path.basename(path.dirname(contractPath)) || 'component_root');
  }
  return toIdSegment(base);
}

function uniquePreservingOrder(values, label) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${label} contains duplicate value '${value}'.`);
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function collectDependencyTargets(node, out) {
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectDependencyTargets(entry, out);
    }
    return;
  }
  if (isNonEmptyString(node)) {
    out.push(node.trim());
    return;
  }
  if (!isObjectLike(node)) {
    return;
  }
  for (const key of stableObjectKeys(node)) {
    if (key === 'refs') {
      for (const ref of asStringArray(node[key], 'component_shared_refs.refs')) {
        out.push(ref);
      }
      continue;
    }
    if (key.endsWith('Ref')) {
      if (!isNonEmptyString(node[key])) {
        throw new Error(`component_shared_refs.${key} must be a non-empty string when declared.`);
      }
      out.push(node[key].trim());
      continue;
    }
    if (key.endsWith('Refs')) {
      for (const ref of asStringArray(node[key], `component_shared_refs.${key}`)) {
        out.push(ref);
      }
      continue;
    }
    collectDependencyTargets(node[key], out);
  }
}

function parseComponentUnit(rawBoundaryId, sourceNode, sourceKind, sourcePath, contractPath, orderIndex) {
  assertRequiredSections(sourceNode, sourcePath);

  const hierarchy = asPlainObject(sourceNode.component_hierarchy_position, `${sourcePath}.component_hierarchy_position`);
  const mount = asPlainObject(sourceNode.component_mount_point, `${sourcePath}.component_mount_point`);
  const inputInterface = asPlainObject(sourceNode.component_input_interface, `${sourcePath}.component_input_interface`);
  const outputInterface = asPlainObject(sourceNode.component_output_interface, `${sourcePath}.component_output_interface`);
  const domainBlocks = asPlainObject(sourceNode.component_domain_blocks, `${sourcePath}.component_domain_blocks`);
  const sharedRefs = asPlainObject(sourceNode.component_shared_refs, `${sourcePath}.component_shared_refs`);

  if (!isNonEmptyString(mount.slotRef)) {
    throw new Error(`${sourcePath}.component_mount_point.slotRef must be a non-empty string.`);
  }
  if (!isNonEmptyString(mount.mount_kind)) {
    throw new Error(`${sourcePath}.component_mount_point.mount_kind must be a non-empty string.`);
  }
  if (!ALLOWED_MOUNT_KINDS.includes(mount.mount_kind.trim())) {
    throw new Error(`${sourcePath}.component_mount_point.mount_kind must be one of: ${ALLOWED_MOUNT_KINDS.join(', ')}.`);
  }

  const mountedChildBoundaryIds = uniquePreservingOrder(
    mount.mounted_child_boundaryRefs === undefined
      ? []
      : asStringArray(
        mount.mounted_child_boundaryRefs,
        `${sourcePath}.component_mount_point.mounted_child_boundaryRefs`
      ),
    `${sourcePath}.component_mount_point.mounted_child_boundaryRefs`
  );

  if (!Array.isArray(outputInterface.exits)) {
    throw new Error(`${sourcePath}.component_output_interface.exits must be an array.`);
  }

  const exitIdSeen = new Set();
  const exits = outputInterface.exits.map((entry, exitIndex) => {
    const exitPath = `${sourcePath}.component_output_interface.exits[${exitIndex}]`;
    const node = asPlainObject(entry, exitPath);
    if (!isNonEmptyString(node.id)) {
      throw new Error(`${exitPath}.id must be a non-empty string.`);
    }
    if (!isNonEmptyString(node.outcome)) {
      throw new Error(`${exitPath}.outcome must be a non-empty string.`);
    }
    const exitId = node.id.trim();
    if (exitIdSeen.has(exitId)) {
      throw new Error(`${sourcePath}.component_output_interface.exits contains duplicate id '${exitId}'.`);
    }
    exitIdSeen.add(exitId);

    const outcome = node.outcome.trim();
    if (!ALLOWED_EXIT_OUTCOMES.includes(outcome)) {
      throw new Error(`${exitPath}.outcome must be one of: ${ALLOWED_EXIT_OUTCOMES.join(', ')}.`);
    }

    const targetBoundaryRef = isNonEmptyString(node.target_boundaryRef) ? node.target_boundaryRef.trim() : null;
    const returnTargetBoundaryRef = isNonEmptyString(node.return_target_boundaryRef)
      ? node.return_target_boundaryRef.trim()
      : null;

    if (outcome === 'continue' && (!targetBoundaryRef || returnTargetBoundaryRef)) {
      throw new Error(`${exitPath} with outcome=continue must declare target_boundaryRef and must not declare return_target_boundaryRef.`);
    }
    if (outcome === 'return' && (!returnTargetBoundaryRef || targetBoundaryRef)) {
      throw new Error(`${exitPath} with outcome=return must declare return_target_boundaryRef and must not declare target_boundaryRef.`);
    }
    if (outcome === 'exit' && (targetBoundaryRef || returnTargetBoundaryRef)) {
      throw new Error(`${exitPath} with outcome=exit must not declare target_boundaryRef or return_target_boundaryRef.`);
    }

    return {
      id: exitId,
      outcome,
      targetBoundaryRef,
      returnTargetBoundaryRef,
      orderIndex: exitIndex,
      sourcePath: exitPath,
    };
  });

  const sharedRefTargets = uniquePreservingOrder(
    (() => {
      const out = [];
      collectDependencyTargets(sharedRefs, out);
      return out;
    })(),
    `${sourcePath}.component_shared_refs`
  );

  const ALLOWED_PROJECTION_DOMAINS = ['topology', 'flow', 'specification'];

  // Build projection_domains eligibility map for each domain block.
  const domainBlockProjectionDomains = new Map();
  for (const blockId of stableObjectKeys(domainBlocks)) {
    const blockValue = domainBlocks[blockId];
    const domainSet = new Set();
    if (isObjectLike(blockValue) && Array.isArray(blockValue.projection_domains)) {
      for (const entry of blockValue.projection_domains) {
        if (isNonEmptyString(entry) && ALLOWED_PROJECTION_DOMAINS.includes(entry.trim())) {
          domainSet.add(entry.trim());
        }
      }
    }
    domainBlockProjectionDomains.set(blockId, domainSet);
  }

  return {
    projectionUnitId: `projection_unit:${toIdSegment(rawBoundaryId)}`,
    boundaryId: rawBoundaryId,
    sourceKind,
    sourcePath,
    parentBoundaryId: isNonEmptyString(hierarchy.parent_boundaryRef) ? hierarchy.parent_boundaryRef.trim() : null,
    localRole: isNonEmptyString(hierarchy.local_role) ? hierarchy.local_role.trim() : null,
    slotRef: mount.slotRef.trim(),
    mountKind: mount.mount_kind.trim(),
    mountedChildBoundaryIds,
    inputInterfaceKeys: stableObjectKeys(inputInterface),
    exits,
    domainBlockIds: stableObjectKeys(domainBlocks),
    domainBlockProjectionDomains,
    sharedRefTargets,
    contractPath,
    orderIndex,
  };
}

function extractComponentUnits(contract, contractPath) {
  const rootPresent = getPresentComponentSections(contract);
  const topLevelCandidates = [];

  for (const key of stableObjectKeys(contract)) {
    const value = contract[key];
    if (!isObjectLike(value)) {
      continue;
    }
    const present = getPresentComponentSections(value);
    if (present.length === 0) {
      continue;
    }
    topLevelCandidates.push({ blockId: key, node: value });
  }

  if (rootPresent.length > 0 && topLevelCandidates.length > 0) {
    throw new Error('Ambiguous component projection units: root contract and top-level blocks both declare component_* sections.');
  }

  if (rootPresent.length > 0) {
    if (rootPresent.length !== CANONICAL_COMPONENT_SECTIONS.length) {
      const missing = CANONICAL_COMPONENT_SECTIONS.filter((section) => !rootPresent.includes(section));
      throw new Error(`Root contract is missing required component sections: ${missing.join(', ')}`);
    }
    return [
      parseComponentUnit(
        deriveRootBoundaryId(contractPath),
        contract,
        'contract_root',
        '$root',
        contractPath,
        0
      ),
    ];
  }

  return topLevelCandidates.map((candidate, index) =>
    parseComponentUnit(candidate.blockId, candidate.node, 'top_level_block', candidate.blockId, contractPath, index)
  );
}

function assertVisualContractConsistency(contract) {
  const issues = [];
  const visual = isObjectLike(contract?.FRIDA_VISUAL) ? contract.FRIDA_VISUAL : null;
  if (!visual) {
    issues.push('FRIDA_VISUAL block is missing or invalid.');
  }
  const projection = visual && isObjectLike(visual.component_projection) ? visual.component_projection : null;
  if (!projection) {
    issues.push('FRIDA_VISUAL.component_projection is missing or invalid.');
  }
  const overlaySchema = visual && isObjectLike(visual.overlay_schema_v1) ? visual.overlay_schema_v1 : null;
  if (!overlaySchema) {
    issues.push('FRIDA_VISUAL.overlay_schema_v1 is missing or invalid.');
  }
  const order = Array.isArray(projection?.current_boundary_establishment?.order)
    ? projection.current_boundary_establishment.order
    : [];
  if (JSON.stringify(order) !== JSON.stringify(REQUIRED_BOUNDARY_ESTABLISHMENT_ORDER)) {
    issues.push('FRIDA_VISUAL.component_projection.current_boundary_establishment.order is invalid.');
  }
  if (overlaySchema) {
    if (overlaySchema.id !== OVERLAY_SCHEMA_ID) {
      issues.push(`FRIDA_VISUAL.overlay_schema_v1.id must equal '${OVERLAY_SCHEMA_ID}'.`);
    }
    if (overlaySchema.version !== OVERLAY_SCHEMA_VERSION) {
      issues.push(`FRIDA_VISUAL.overlay_schema_v1.version must equal '${OVERLAY_SCHEMA_VERSION}'.`);
    }
    if (overlaySchema.output_pathRef !== 'PATHS.visual.overlayFile') {
      issues.push('FRIDA_VISUAL.overlay_schema_v1.output_pathRef must equal PATHS.visual.overlayFile.');
    }
    if (overlaySchema.projection_authorityRef !== OVERLAY_PROJECTION_AUTHORITY) {
      issues.push(`FRIDA_VISUAL.overlay_schema_v1.projection_authorityRef must equal ${OVERLAY_PROJECTION_AUTHORITY}.`);
    }
  }
  if (issues.length > 0) {
    throw new Error(`Visual contract consistency failed: ${issues.join(' | ')}`);
  }
}

function assertUnitRelations(units) {
  const boundaryIdSet = new Set(units.map((unit) => unit.boundaryId));
  const unitByBoundaryId = new Map(units.map((unit) => [unit.boundaryId, unit]));
  const mountedChildOwner = new Map();
  const hostRootUnits = units.filter((unit) => unit.localRole === 'host_root');

  if (hostRootUnits.length > 1) {
    throw new Error(`Multiple host_root anchors are declared: ${hostRootUnits.map((unit) => unit.boundaryId).join(', ')}.`);
  }

  const hostRootUnit = hostRootUnits[0] || null;
  if (hostRootUnit) {
    if (hostRootUnit.parentBoundaryId) {
      throw new Error(`${hostRootUnit.sourcePath}.component_hierarchy_position.local_role=host_root must omit parent_boundaryRef.`);
    }
    if (hostRootUnit.mountKind !== 'host-static') {
      throw new Error(`${hostRootUnit.sourcePath}.component_mount_point.mount_kind must equal host-static for local_role=host_root.`);
    }
  }

  for (const unit of units) {
    if (unit.parentBoundaryId && !boundaryIdSet.has(unit.parentBoundaryId)) {
      throw new Error(`Unresolved parent boundary '${unit.parentBoundaryId}' referenced by ${unit.sourcePath}.component_hierarchy_position.parent_boundaryRef.`);
    }
    for (const childBoundaryId of unit.mountedChildBoundaryIds) {
      if (childBoundaryId === unit.boundaryId) {
        throw new Error(`${unit.sourcePath}.component_mount_point.mounted_child_boundaryRefs must not reference the current boundary '${childBoundaryId}'.`);
      }
      if (!boundaryIdSet.has(childBoundaryId)) {
        throw new Error(`Unresolved mounted child boundary '${childBoundaryId}' referenced by ${unit.sourcePath}.component_mount_point.mounted_child_boundaryRefs.`);
      }
      const existingParent = mountedChildOwner.get(childBoundaryId);
      if (existingParent && existingParent !== unit.boundaryId) {
        throw new Error(`Ambiguous mounted child relation: boundary '${childBoundaryId}' is mounted by both '${existingParent}' and '${unit.boundaryId}'.`);
      }
      mountedChildOwner.set(childBoundaryId, unit.boundaryId);
    }
    for (const exit of unit.exits) {
      if (exit.outcome === 'continue' && (!exit.targetBoundaryRef || !boundaryIdSet.has(exit.targetBoundaryRef))) {
        throw new Error(`Unresolved continuation target '${exit.targetBoundaryRef || ''}' in ${exit.sourcePath}.`);
      }
      if (exit.outcome === 'return' && (!exit.returnTargetBoundaryRef || !boundaryIdSet.has(exit.returnTargetBoundaryRef))) {
        throw new Error(`Unresolved return target '${exit.returnTargetBoundaryRef || ''}' in ${exit.sourcePath}.`);
      }
    }
    for (const childBoundaryId of unit.mountedChildBoundaryIds) {
      if (unit.domainBlockIds.includes(childBoundaryId)) {
        throw new Error(`Illegal child inline expansion: ${unit.sourcePath}.component_domain_blocks must not inline mounted child boundary '${childBoundaryId}'.`);
      }
    }
    for (const dependencyTarget of unit.sharedRefTargets) {
      if (boundaryIdSet.has(dependencyTarget)) {
        throw new Error(`Dependency edge misuse: ${unit.sourcePath}.component_shared_refs targets boundary '${dependencyTarget}' instead of a shared ref.`);
      }
    }
  }

  for (const unit of units) {
    const seen = new Set([unit.boundaryId]);
    let cursor = unit;
    while (cursor.parentBoundaryId) {
      if (seen.has(cursor.parentBoundaryId)) {
        throw new Error(`Cyclic parent chain detected at boundary '${cursor.parentBoundaryId}'.`);
      }
      seen.add(cursor.parentBoundaryId);
      const parent = unitByBoundaryId.get(cursor.parentBoundaryId);
      if (!parent) {
        break;
      }
      cursor = parent;
    }

    if (hostRootUnit && unit.boundaryId !== hostRootUnit.boundaryId) {
      if (unit.parentBoundaryId === null) {
        throw new Error(`Boundary '${unit.boundaryId}' omits parent_boundaryRef even though host_root '${hostRootUnit.boundaryId}' is present.`);
      }
      if (!seen.has(hostRootUnit.boundaryId)) {
        throw new Error(`Boundary '${unit.boundaryId}' does not resolve upward to host_root '${hostRootUnit.boundaryId}'.`);
      }
    }
  }
}

function sortById(items) {
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

function sortNodes(items) {
  return items.sort((a, b) => {
    if (a.boundary_id !== b.boundary_id) {
      return (a.boundary_id || '').localeCompare(b.boundary_id || '');
    }
    if (a.order_index !== b.order_index) {
      return a.order_index - b.order_index;
    }
    return a.id.localeCompare(b.id);
  });
}

function sortEdges(items) {
  return items.sort((a, b) => {
    if (a.source_boundary_id !== b.source_boundary_id) {
      return (a.source_boundary_id || '').localeCompare(b.source_boundary_id || '');
    }
    if (a.order_index !== b.order_index) {
      return a.order_index - b.order_index;
    }
    return a.id.localeCompare(b.id);
  });
}

function buildContextShellHint(unit) {
  return {
    id: `context_shell:${toIdSegment(unit.boundaryId)}`,
    boundary_id: unit.boundaryId,
    projection_unit_id: unit.projectionUnitId,
    parent_boundary_id: unit.parentBoundaryId,
    local_role: unit.localRole,
    mount_kind: unit.mountKind,
    shell_hint: unit.mountKind === 'host-static' ? 'host_static_shell' : 'mapper_managed_shell',
    order_index: unit.orderIndex,
  };
}

function buildTraceHint(unit, entryPointId, exitPointIds, mountedChildRelationIds, continuationMappingIds, returnMappingIds) {
  return {
    id: `trace_projection:${toIdSegment(unit.boundaryId)}`,
    boundary_id: unit.boundaryId,
    projection_unit_id: unit.projectionUnitId,
    entry_point_id: entryPointId,
    exit_point_ids: [...exitPointIds],
    mounted_child_relation_ids: [...mountedChildRelationIds],
    continuation_mapping_ids: [...continuationMappingIds],
    return_mapping_ids: [...returnMappingIds],
    order_index: unit.orderIndex,
  };
}

function assertOverlayShape(overlay) {
  const issues = [];
  if (overlay.meta.schema_id !== OVERLAY_SCHEMA_ID) {
    issues.push(`meta.schema_id must equal '${OVERLAY_SCHEMA_ID}'.`);
  }
  if (overlay.meta.schema_version !== OVERLAY_SCHEMA_VERSION) {
    issues.push(`meta.schema_version must equal '${OVERLAY_SCHEMA_VERSION}'.`);
  }
  if (overlay.meta.projection_unit_count !== overlay.projection_units.length) {
    issues.push('meta.projection_unit_count does not match projection_units.length.');
  }
  if (overlay.meta.component_boundary_count !== overlay.component_boundaries.length) {
    issues.push('meta.component_boundary_count does not match component_boundaries.length.');
  }
  if (overlay.meta.topology_node_count !== overlay.topology_nodes.length) {
    issues.push('meta.topology_node_count does not match topology_nodes.length.');
  }
  if (overlay.meta.topology_edge_count !== overlay.topology_edges.length) {
    issues.push('meta.topology_edge_count does not match topology_edges.length.');
  }
  if (overlay.meta.flow_node_count !== overlay.flow_nodes.length) {
    issues.push('meta.flow_node_count does not match flow_nodes.length.');
  }
  if (overlay.meta.flow_edge_count !== overlay.flow_edges.length) {
    issues.push('meta.flow_edge_count does not match flow_edges.length.');
  }
  if (overlay.meta.specification_node_count !== overlay.specification_nodes.length) {
    issues.push('meta.specification_node_count does not match specification_nodes.length.');
  }
  if (overlay.meta.specification_edge_count !== overlay.specification_edges.length) {
    issues.push('meta.specification_edge_count does not match specification_edges.length.');
  }
  if (overlay.meta.dependency_edge_count !== overlay.dependency_edges.length) {
    issues.push('meta.dependency_edge_count does not match dependency_edges.length.');
  }
  const arrays = [
    ['projection_units', overlay.projection_units],
    ['component_boundaries', overlay.component_boundaries],
    ['topology_nodes', overlay.topology_nodes],
    ['topology_edges', overlay.topology_edges],
    ['flow_nodes', overlay.flow_nodes],
    ['flow_edges', overlay.flow_edges],
    ['specification_nodes', overlay.specification_nodes],
    ['specification_edges', overlay.specification_edges],
    ['entry_points', overlay.entry_points],
    ['exit_points', overlay.exit_points],
    ['mounted_child_relations', overlay.mounted_child_relations],
    ['continuation_mappings', overlay.continuation_mappings],
    ['return_mappings', overlay.return_mappings],
    ['dependency_edges', overlay.dependency_edges],
    ['context_shell_hints', overlay.context_shell_hints],
    ['trace_projection_hints', overlay.trace_projection_hints],
  ];
  for (const [label, items] of arrays) {
    const seen = new Set();
    for (const item of items) {
      if (!isObjectLike(item) || !isNonEmptyString(item.id)) {
        issues.push(`${label} contains an item without a non-empty id.`);
        continue;
      }
      if (seen.has(item.id.trim())) {
        issues.push(`${label} contains duplicate id '${item.id.trim()}'.`);
        continue;
      }
      seen.add(item.id.trim());
    }
  }
  if (issues.length > 0) {
    throw new Error(`Overlay schema v1 validation failed: ${issues.join(' | ')}`);
  }
}

export function extractVisualSchemaOverlay(contract, contractRaw, options = {}) {
  assertVisualContractConsistency(contract);
  const sourcePath = options.sourcePath || path.posix.join('contract', 'contract.index.yaml');
  const contractPath = options.contractPath || sourcePath;
  const units = extractComponentUnits(contract, contractPath);
  assertUnitRelations(units);

  const projectionUnits = [];
  const componentBoundaries = [];
  const topologyNodes = [];
  const topologyEdges = [];
  const flowNodes = [];
  const flowEdges = [];
  const specificationNodes = [];
  const specificationEdges = [];
  const entryPoints = [];
  const exitPoints = [];
  const mountedChildRelations = [];
  const continuationMappings = [];
  const returnMappings = [];
  const dependencyEdges = [];
  const contextShellHints = [];
  const traceProjectionHints = [];
  const dependencyTargetNodeIds = new Set();

  const boundaryNodeIdByBoundaryId = new Map();
  const entryPointIdByBoundaryId = new Map();
  const entryFlowNodeIdByBoundaryId = new Map();

  for (const unit of units) {
    const boundarySegment = toIdSegment(unit.boundaryId);
    boundaryNodeIdByBoundaryId.set(unit.boundaryId, `topology:boundary:${boundarySegment}`);
    entryPointIdByBoundaryId.set(unit.boundaryId, `entry_point:${boundarySegment}`);
    entryFlowNodeIdByBoundaryId.set(unit.boundaryId, `flow:entry:${boundarySegment}`);
  }

  for (const unit of units) {
    const boundarySegment = toIdSegment(unit.boundaryId);
    const boundaryRecordId = `boundary:${boundarySegment}`;
    const boundaryNodeId = boundaryNodeIdByBoundaryId.get(unit.boundaryId);
    const entryPointId = entryPointIdByBoundaryId.get(unit.boundaryId);
    const entryFlowNodeId = entryFlowNodeIdByBoundaryId.get(unit.boundaryId);
    const inboundInterfaceFlowNodeId = `flow:inbound_interface:${boundarySegment}`;

    projectionUnits.push({
      id: unit.projectionUnitId,
      boundary_id: unit.boundaryId,
      source_kind: unit.sourceKind,
      source_path: unit.sourcePath,
      contract_path: sourcePath,
      order_index: unit.orderIndex,
    });

    entryPoints.push({
      id: entryPointId,
      boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      flow_node_id: entryFlowNodeId,
      slot_ref: unit.slotRef,
      mount_kind: unit.mountKind,
      order_index: unit.orderIndex,
    });

    topologyNodes.push({
      id: boundaryNodeId,
      kind: 'component_boundary',
      boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      label: unit.boundaryId,
      source_path: `${unit.sourcePath}.component_hierarchy_position`,
      order_index: unit.orderIndex,
    });

    flowNodes.push({
      id: entryFlowNodeId,
      kind: 'entry_point',
      boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      label: `${unit.boundaryId}:entry`,
      source_path: `${unit.sourcePath}.component_mount_point`,
      order_index: unit.orderIndex,
    });
    flowNodes.push({
      id: inboundInterfaceFlowNodeId,
      kind: 'inbound_interface',
      boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      label: `${unit.boundaryId}:inbound`,
      source_path: `${unit.sourcePath}.component_input_interface`,
      order_index: unit.orderIndex,
    });
    flowEdges.push({
      id: `flow_edge:entry_to_inbound_interface:${boundarySegment}`,
      kind: 'entry_to_inbound_interface',
      source_id: entryFlowNodeId,
      target_id: inboundInterfaceFlowNodeId,
      source_boundary_id: unit.boundaryId,
      target_boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      source_path: `${unit.sourcePath}.component_mount_point`,
      order_index: unit.orderIndex,
    });

    const specBoundaryNodeId = `specification:boundary:${boundarySegment}`;
    const sectionNodeIds = {
      component_hierarchy_position: `specification:section:${boundarySegment}:${SPECIFICATION_SECTION_IDS.component_hierarchy_position}`,
      component_mount_point: `specification:section:${boundarySegment}:${SPECIFICATION_SECTION_IDS.component_mount_point}`,
      component_input_interface: `specification:section:${boundarySegment}:${SPECIFICATION_SECTION_IDS.component_input_interface}`,
      component_output_interface: `specification:section:${boundarySegment}:${SPECIFICATION_SECTION_IDS.component_output_interface}`,
      component_domain_blocks: `specification:section:${boundarySegment}:${SPECIFICATION_SECTION_IDS.component_domain_blocks}`,
      component_shared_refs: `specification:section:${boundarySegment}:${SPECIFICATION_SECTION_IDS.component_shared_refs}`,
    };

    specificationNodes.push({
      id: specBoundaryNodeId,
      kind: 'component_boundary',
      boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      label: unit.boundaryId,
      source_path: unit.sourcePath,
      order_index: unit.orderIndex,
    });

    const boundaryExitPointIds = [];
    const boundaryMountedChildRelationIds = [];
    const boundaryContinuationIds = [];
    const boundaryReturnIds = [];

    for (const [sectionIndex, sectionId] of CANONICAL_COMPONENT_SECTIONS.entries()) {
      const sectionNodeId = sectionNodeIds[sectionId];
      specificationNodes.push({
        id: sectionNodeId,
        kind: `section:${SPECIFICATION_SECTION_IDS[sectionId]}`,
        boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        label: SPECIFICATION_SECTION_IDS[sectionId],
        source_path: `${unit.sourcePath}.${sectionId}`,
        order_index: sectionIndex,
      });
      specificationEdges.push({
        id: `specification_edge:contains_section:${boundarySegment}:${SPECIFICATION_SECTION_IDS[sectionId]}`,
        kind: 'contains_section',
        source_id: specBoundaryNodeId,
        target_id: sectionNodeId,
        source_boundary_id: unit.boundaryId,
        target_boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        source_path: unit.sourcePath,
        order_index: sectionIndex,
      });
    }

    componentBoundaries.push({
      id: boundaryRecordId,
      boundary_id: unit.boundaryId,
      projection_unit_id: unit.projectionUnitId,
      source_path: unit.sourcePath,
      parent_boundary_id: unit.parentBoundaryId,
      local_role: unit.localRole,
      slot_ref: unit.slotRef,
      mount_kind: unit.mountKind,
      entry_point_id: entryPointId,
      exit_point_ids: [],
      mounted_child_boundary_ids: [...unit.mountedChildBoundaryIds],
      content_node_ids: [...unit.domainBlockIds],
      dependency_targets: [...unit.sharedRefTargets],
      inbound_interface_keys: [...unit.inputInterfaceKeys],
      order_index: unit.orderIndex,
    });

    if (unit.parentBoundaryId) {
      topologyEdges.push({
        id: `topology_edge:parent_child:${toIdSegment(unit.parentBoundaryId)}:${boundarySegment}`,
        kind: 'parent_child',
        source_id: boundaryNodeIdByBoundaryId.get(unit.parentBoundaryId) || `topology:boundary:${toIdSegment(unit.parentBoundaryId)}`,
        target_id: boundaryNodeId,
        source_boundary_id: unit.parentBoundaryId,
        target_boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        source_path: `${unit.sourcePath}.component_hierarchy_position`,
        order_index: unit.orderIndex,
      });
    }

    for (const [domainIndex, domainBlockId] of unit.domainBlockIds.entries()) {
      const domainNodeId = `specification:domain:${boundarySegment}:${toIdSegment(domainBlockId)}`;
      const blockProjectionDomains = unit.domainBlockProjectionDomains.get(domainBlockId) ?? new Set();

      if (blockProjectionDomains.has('topology')) {
        const topologyDomainNodeId = `topology:domain:${boundarySegment}:${toIdSegment(domainBlockId)}`;
        topologyNodes.push({
          id: topologyDomainNodeId,
          kind: 'domain_block',
          boundary_id: unit.boundaryId,
          projection_unit_id: unit.projectionUnitId,
          label: domainBlockId,
          source_path: `${unit.sourcePath}.component_domain_blocks.${domainBlockId}`,
          order_index: domainIndex,
        });
        topologyEdges.push({
          id: `topology_edge:contains_domain_block:${boundarySegment}:${toIdSegment(domainBlockId)}`,
          kind: 'contains_domain_block',
          source_id: boundaryNodeId,
          target_id: topologyDomainNodeId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: unit.boundaryId,
          projection_unit_id: unit.projectionUnitId,
          source_path: `${unit.sourcePath}.component_domain_blocks.${domainBlockId}`,
          order_index: domainIndex,
        });
      }

      // Specification: always emit the collapsed specification-local declaration anchor.
      specificationNodes.push({
        id: domainNodeId,
        kind: 'domain_block',
        boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        label: domainBlockId,
        source_path: `${unit.sourcePath}.component_domain_blocks.${domainBlockId}`,
        order_index: domainIndex,
      });
      specificationEdges.push({
        id: `specification_edge:contains_domain_block:${boundarySegment}:${toIdSegment(domainBlockId)}`,
        kind: 'contains_domain_block',
        source_id: sectionNodeIds.component_domain_blocks,
        target_id: domainNodeId,
        source_boundary_id: unit.boundaryId,
        target_boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        source_path: `${unit.sourcePath}.component_domain_blocks`,
        order_index: domainIndex,
      });

      // Flow: only blocks with explicit projection_domains containing 'flow' are projected.
      if (blockProjectionDomains.has('flow')) {
        const flowDomainNodeId = `flow:domain:${boundarySegment}:${toIdSegment(domainBlockId)}`;
        flowNodes.push({
          id: flowDomainNodeId,
          kind: 'domain_block',
          boundary_id: unit.boundaryId,
          projection_unit_id: unit.projectionUnitId,
          label: domainBlockId,
          source_path: `${unit.sourcePath}.component_domain_blocks.${domainBlockId}`,
          order_index: domainIndex,
        });
        flowEdges.push({
          id: `flow_edge:inbound_interface_to_domain:${boundarySegment}:${toIdSegment(domainBlockId)}`,
          kind: 'inbound_interface_to_domain_block',
          source_id: inboundInterfaceFlowNodeId,
          target_id: flowDomainNodeId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: unit.boundaryId,
          projection_unit_id: unit.projectionUnitId,
          source_path: `${unit.sourcePath}.component_domain_blocks.${domainBlockId}`,
          order_index: domainIndex,
        });
      }
    }

    for (const [sharedIndex, dependencyTarget] of unit.sharedRefTargets.entries()) {
      const dependencyTargetNodeId = `specification:dependency_target:${toIdSegment(dependencyTarget)}`;
      if (!dependencyTargetNodeIds.has(dependencyTargetNodeId)) {
        specificationNodes.push({
          id: dependencyTargetNodeId,
          kind: 'dependency_target',
          boundary_id: null,
          projection_unit_id: null,
          label: dependencyTarget,
          source_path: `${unit.sourcePath}.component_shared_refs`,
          order_index: sharedIndex,
        });
        dependencyTargetNodeIds.add(dependencyTargetNodeId);
      }
      dependencyEdges.push({
        id: `dependency_edge:${boundarySegment}:${sharedIndex}:${toIdSegment(dependencyTarget)}`,
        source_boundary_id: unit.boundaryId,
        source_node_id: sectionNodeIds.component_shared_refs,
        target_ref: dependencyTarget,
        target_node_id: dependencyTargetNodeId,
        projection_unit_id: unit.projectionUnitId,
        source_path: `${unit.sourcePath}.component_shared_refs`,
        order_index: sharedIndex,
      });
    }

    for (const exit of unit.exits) {
      const exitNodeId = `flow:exit:${boundarySegment}:${toIdSegment(exit.id)}`;
      const exitPointId = `exit_point:${boundarySegment}:${toIdSegment(exit.id)}`;
      boundaryExitPointIds.push(exitPointId);

      flowNodes.push({
        id: exitNodeId,
        kind: 'exit_point',
        boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        label: exit.id,
        source_path: exit.sourcePath,
        order_index: exit.orderIndex,
      });

      flowEdges.push({
        id: `flow_edge:inbound_interface_to_exit:${boundarySegment}:${toIdSegment(exit.id)}`,
        kind: 'inbound_interface_to_exit',
        source_id: inboundInterfaceFlowNodeId,
        target_id: exitNodeId,
        source_boundary_id: unit.boundaryId,
        target_boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        source_path: exit.sourcePath,
        order_index: exit.orderIndex,
      });
      // Only flow-projected domain blocks produce domain_block_to_exit edges.
      for (const [domainIndex, domainBlockId] of unit.domainBlockIds.entries()) {
        const blockProjectionDomains = unit.domainBlockProjectionDomains.get(domainBlockId) ?? new Set();
        if (!blockProjectionDomains.has('flow')) {
          continue;
        }
        flowEdges.push({
          id: `flow_edge:domain_to_exit:${boundarySegment}:${toIdSegment(domainBlockId)}:${toIdSegment(exit.id)}`,
          kind: 'domain_block_to_exit',
          source_id: `flow:domain:${boundarySegment}:${toIdSegment(domainBlockId)}`,
          target_id: exitNodeId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: unit.boundaryId,
          projection_unit_id: unit.projectionUnitId,
          source_path: `${unit.sourcePath}.component_domain_blocks.${domainBlockId}`,
          order_index: domainIndex * 100 + exit.orderIndex,
        });
      }

      exitPoints.push({
        id: exitPointId,
        boundary_id: unit.boundaryId,
        projection_unit_id: unit.projectionUnitId,
        flow_node_id: exitNodeId,
        exit_id: exit.id,
        outcome: exit.outcome,
        continuation_target_boundary_id: exit.targetBoundaryRef,
        return_target_boundary_id: exit.returnTargetBoundaryRef,
        order_index: exit.orderIndex,
      });

      if (exit.outcome === 'continue' && exit.targetBoundaryRef) {
        const targetEntryFlowNodeId = entryFlowNodeIdByBoundaryId.get(exit.targetBoundaryRef);
        if (!targetEntryFlowNodeId) {
          throw new Error(`Continuation target '${exit.targetBoundaryRef}' has no entry point in the overlay compiler state.`);
        }
        const edgeId = `flow_edge:continue:${boundarySegment}:${toIdSegment(exit.id)}:${toIdSegment(exit.targetBoundaryRef)}`;
        flowEdges.push({
          id: edgeId,
          kind: 'continue',
          source_id: exitNodeId,
          target_id: targetEntryFlowNodeId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: exit.targetBoundaryRef,
          projection_unit_id: unit.projectionUnitId,
          source_path: exit.sourcePath,
          order_index: exit.orderIndex,
        });
        const mappingId = `continuation_mapping:${boundarySegment}:${toIdSegment(exit.id)}`;
        continuationMappings.push({
          id: mappingId,
          source_exit_point_id: exitPointId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: exit.targetBoundaryRef,
          projection_unit_id: unit.projectionUnitId,
          flow_edge_id: edgeId,
          order_index: exit.orderIndex,
        });
        boundaryContinuationIds.push(mappingId);
      }

      if (exit.outcome === 'return' && exit.returnTargetBoundaryRef) {
        const targetEntryFlowNodeId = entryFlowNodeIdByBoundaryId.get(exit.returnTargetBoundaryRef);
        if (!targetEntryFlowNodeId) {
          throw new Error(`Return target '${exit.returnTargetBoundaryRef}' has no entry point in the overlay compiler state.`);
        }
        const edgeId = `flow_edge:return:${boundarySegment}:${toIdSegment(exit.id)}:${toIdSegment(exit.returnTargetBoundaryRef)}`;
        flowEdges.push({
          id: edgeId,
          kind: 'return',
          source_id: exitNodeId,
          target_id: targetEntryFlowNodeId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: exit.returnTargetBoundaryRef,
          projection_unit_id: unit.projectionUnitId,
          source_path: exit.sourcePath,
          order_index: exit.orderIndex,
        });
        const mappingId = `return_mapping:${boundarySegment}:${toIdSegment(exit.id)}`;
        returnMappings.push({
          id: mappingId,
          source_exit_point_id: exitPointId,
          source_boundary_id: unit.boundaryId,
          target_boundary_id: exit.returnTargetBoundaryRef,
          projection_unit_id: unit.projectionUnitId,
          flow_edge_id: edgeId,
          order_index: exit.orderIndex,
        });
        boundaryReturnIds.push(mappingId);
      }
    }

    for (const [childIndex, childBoundaryId] of unit.mountedChildBoundaryIds.entries()) {
      const topologyEdgeId = `topology_edge:mounted_child:${boundarySegment}:${toIdSegment(childBoundaryId)}`;
      topologyEdges.push({
        id: topologyEdgeId,
        kind: 'mounted_child',
        source_id: boundaryNodeId,
        target_id: boundaryNodeIdByBoundaryId.get(childBoundaryId) || `topology:boundary:${toIdSegment(childBoundaryId)}`,
        source_boundary_id: unit.boundaryId,
        target_boundary_id: childBoundaryId,
        projection_unit_id: unit.projectionUnitId,
        source_path: `${unit.sourcePath}.component_mount_point.mounted_child_boundaryRefs[${childIndex}]`,
        order_index: childIndex,
      });
      const relationId = `mounted_child_relation:${boundarySegment}:${toIdSegment(childBoundaryId)}`;
      mountedChildRelations.push({
        id: relationId,
        parent_boundary_id: unit.boundaryId,
        child_boundary_id: childBoundaryId,
        projection_unit_id: unit.projectionUnitId,
        topology_edge_id: topologyEdgeId,
        order_index: childIndex,
      });
      boundaryMountedChildRelationIds.push(relationId);
    }

    const boundaryRecord = componentBoundaries.find((record) => record.boundary_id === unit.boundaryId);
    if (boundaryRecord) {
      boundaryRecord.exit_point_ids = [...boundaryExitPointIds];
    }

    contextShellHints.push(buildContextShellHint(unit));
    traceProjectionHints.push(
      buildTraceHint(
        unit,
        entryPointId,
        boundaryExitPointIds,
        boundaryMountedChildRelationIds,
        boundaryContinuationIds,
        boundaryReturnIds
      )
    );
  }

  const overlay = {
    meta: {
      schema_id: OVERLAY_SCHEMA_ID,
      schema_version: OVERLAY_SCHEMA_VERSION,
      generated_at: options.generatedAt || new Date().toISOString(),
      contract_sha256: sha256(contractRaw),
      source: options.sourcePath || path.posix.join('contract', 'contract.index.yaml'),
      overlay_path: options.outputPath || resolveVisualOverlayPath(contract),
      builder_entrypoint: OVERLAY_BUILDER_ENTRYPOINT,
      builder_command: OVERLAY_BUILDER_COMMAND,
      projection_authority_ref: OVERLAY_PROJECTION_AUTHORITY,
      projection_unit_count: projectionUnits.length,
      component_boundary_count: componentBoundaries.length,
      topology_node_count: topologyNodes.length,
      topology_edge_count: topologyEdges.length,
      flow_node_count: flowNodes.length,
      flow_edge_count: flowEdges.length,
      specification_node_count: specificationNodes.length,
      specification_edge_count: specificationEdges.length,
      dependency_edge_count: dependencyEdges.length,
    },
    projection_units: sortById(projectionUnits),
    component_boundaries: sortById(componentBoundaries),
    topology_nodes: sortNodes(topologyNodes),
    topology_edges: sortEdges(topologyEdges),
    flow_nodes: sortNodes(flowNodes),
    flow_edges: sortEdges(flowEdges),
    specification_nodes: sortNodes(specificationNodes),
    specification_edges: sortEdges(specificationEdges),
    entry_points: sortById(entryPoints),
    exit_points: sortById(exitPoints),
    mounted_child_relations: sortById(mountedChildRelations),
    continuation_mappings: sortById(continuationMappings),
    return_mappings: sortById(returnMappings),
    dependency_edges: sortById(dependencyEdges),
    context_shell_hints: sortById(contextShellHints),
    trace_projection_hints: sortById(traceProjectionHints),
  };

  assertOverlayShape(overlay);
  return overlay;
}

export function normalizeOverlayForComparison(overlay) {
  return {
    ...overlay,
    meta: {
      ...overlay.meta,
      generated_at: '__fixed__',
    },
  };
}

export { FIXED_TIMESTAMP };
