import type {
    BoundaryMappingRecord,
    ComponentBoundaryRecord,
    ContextShellHintRecord,
    DependencyEdgeRecord,
    EntryPointRecord,
    ExitPointRecord,
    MountedChildRelationRecord,
    OverlayEdgeRecord,
    OverlayNodeRecord,
    TraceProjectionHintRecord,
    VisualOverlayV1,
} from './visual.ts';

const VIEWER_RUNTIME_SCHEMA_ID = 'frida-visual-viewer-runtime';
const VIEWER_RUNTIME_SCHEMA_VERSION = '1.0.0';
const VIEWER_RUNTIME_AUTHORITY_REF = 'FRIDA_VISUAL.viewer_runtime_v1';
const OVERLAY_SCHEMA_ID = 'frida-visual-overlay';
const OVERLAY_SCHEMA_VERSION = '1.0.0';

export type ViewerLod = 'topology' | 'flow' | 'specification';
export type ViewerPositionHint = 'root_boundary' | 'nested_boundary';
export type ViewerScopeVia = 'root' | 'enter' | 'up';
export type ViewerPortalKind = 'mounted_child_relation' | 'continuation' | 'return';
export type ViewerTraceProjectionMode = 'off' | 'boundary' | 'exit';
export type ViewerFocusKind =
    | 'boundary'
    | 'topology_node'
    | 'topology_edge'
    | 'flow_node'
    | 'flow_edge'
    | 'specification_node'
    | 'specification_edge'
    | 'entry_point'
    | 'exit_point'
    | 'mounted_child_relation'
    | 'continuation_mapping'
    | 'return_mapping'
    | 'dependency_edge'
    | 'context_shell'
    | 'trace';

export interface VisualViewerScope {
    id: string;
    boundary_id: string;
    parent_boundary_id: string | null;
    caller_boundary_id: string | null;
    via: ViewerScopeVia;
    via_portal_kind: ViewerPortalKind | null;
    via_portal_id: string | null;
    via_exit_point_id: string | null;
    depth: number;
}

export interface VisualViewerFocus {
    entity_kind: ViewerFocusKind;
    entity_id: string;
    boundary_id: string | null;
}

export interface VisualViewerContextShell {
    id: string;
    boundary_id: string;
    caller_boundary_id: string | null;
    parent_boundary_id: string | null;
    entry_point_id: string;
    public_exit_point_ids: string[];
    mounted_child_relation_ids: string[];
    continuation_target_boundary_ids: string[];
    return_target_boundary_ids: string[];
    shell_hint: string | null;
    local_role: string | null;
    current_position_hint: ViewerPositionHint;
    minimap_boundary_ids: string[];
    trace_hint_id: string | null;
}

export interface VisualViewerPeekState {
    open: boolean;
    boundary_id: string | null;
    source_boundary_id: string | null;
    relation_id: string | null;
    context_shell_id: string | null;
}

export interface VisualViewerTraceState {
    open: boolean;
    boundary_id: string | null;
    entry_point_id: string | null;
    exit_point_id: string | null;
    continuation_mapping_ids: string[];
    return_mapping_ids: string[];
    projection_mode: ViewerTraceProjectionMode;
}

export interface VisualViewerNavigationFrame {
    id: string;
    scope: VisualViewerScope;
    lod: ViewerLod;
    focus: VisualViewerFocus | null;
    peek: VisualViewerPeekState;
    trace_state: VisualViewerTraceState;
    order_index: number;
}

export interface VisualViewerRuntimeStateV1 {
    meta: {
        schema_id: string;
        schema_version: string;
        overlay_schema_id: string;
        overlay_schema_version: string;
        viewer_authority_ref: string;
        overlay_boundary_count: number;
        overlay_source: string;
    };
    current_scope: VisualViewerScope;
    current_lod: ViewerLod;
    focus: VisualViewerFocus | null;
    context_shell: VisualViewerContextShell;
    peek: VisualViewerPeekState;
    navigation_stack: VisualViewerNavigationFrame[];
    trace_state: VisualViewerTraceState;
}

export interface VisualViewerFrame {
    scope_boundary_id: string;
    lod: ViewerLod;
    focus: VisualViewerFocus | null;
    context_shell: VisualViewerContextShell;
    peek: VisualViewerPeekState;
    trace_state: VisualViewerTraceState;
    visible: {
        topology_nodes: OverlayNodeRecord[];
        topology_edges: OverlayEdgeRecord[];
        flow_nodes: OverlayNodeRecord[];
        flow_edges: OverlayEdgeRecord[];
        specification_nodes: OverlayNodeRecord[];
        specification_edges: OverlayEdgeRecord[];
        entry_points: EntryPointRecord[];
        exit_points: ExitPointRecord[];
        mounted_child_relations: MountedChildRelationRecord[];
        continuation_mappings: BoundaryMappingRecord[];
        return_mappings: BoundaryMappingRecord[];
        dependency_edges: DependencyEdgeRecord[];
    };
    portal_targets: {
        enter_boundary_ids: string[];
        peek_boundary_ids: string[];
        up_boundary_id: string | null;
        can_back: boolean;
    };
}

export type VisualViewerAction =
    | {
          type: 'change_lod';
          lod: ViewerLod;
      }
    | {
          type: 'set_focus';
          focus: VisualViewerFocus | null;
      }
    | {
          type: 'peek';
          target_boundary_id: string;
          relation_id?: string;
      }
    | {
          type: 'enter';
          target_boundary_id: string;
          portal_kind?: ViewerPortalKind;
          portal_id?: string;
      }
    | {
          type: 'up';
      }
    | {
          type: 'back';
      }
    | {
          type: 'open_trace';
          boundary_id?: string;
          exit_point_id?: string;
      }
    | {
          type: 'close_trace';
      }
    | {
          type: 'center_on_entry';
          entry_point_id?: string;
      }
    | {
          type: 'center_on_exit';
          exit_point_id: string;
      };

interface ViewerIndexes {
    boundariesById: Map<string, ComponentBoundaryRecord>;
    boundaryRecordIdByBoundaryId: Map<string, string>;
    entryPointsByBoundaryId: Map<string, EntryPointRecord>;
    exitPointsByBoundaryId: Map<string, ExitPointRecord[]>;
    mountedChildRelationsByParent: Map<string, MountedChildRelationRecord[]>;
    mountedChildRelationsById: Map<string, MountedChildRelationRecord>;
    continuationMappingsByBoundaryId: Map<string, BoundaryMappingRecord[]>;
    continuationMappingsById: Map<string, BoundaryMappingRecord>;
    returnMappingsByBoundaryId: Map<string, BoundaryMappingRecord[]>;
    returnMappingsById: Map<string, BoundaryMappingRecord>;
    contextShellByBoundaryId: Map<string, ContextShellHintRecord>;
    traceHintByBoundaryId: Map<string, TraceProjectionHintRecord>;
    topologyNodesByBoundaryId: Map<string, OverlayNodeRecord[]>;
    topologyEdgesByBoundaryId: Map<string, OverlayEdgeRecord[]>;
    flowNodesByBoundaryId: Map<string, OverlayNodeRecord[]>;
    flowEdgesByBoundaryId: Map<string, OverlayEdgeRecord[]>;
    specificationNodesByBoundaryId: Map<string, OverlayNodeRecord[]>;
    specificationEdgesByBoundaryId: Map<string, OverlayEdgeRecord[]>;
    dependencyEdgesByBoundaryId: Map<string, DependencyEdgeRecord[]>;
    exitPointById: Map<string, ExitPointRecord>;
    entryPointById: Map<string, EntryPointRecord>;
    focusPresence: Map<ViewerFocusKind, Set<string>>;
}

function toIdSegment(value: string): string {
    const normalized = String(value || '')
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return normalized || 'root';
}

function sortById<T extends { id: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function pushGrouped<T>(map: Map<string, T[]>, key: string, value: T): void {
    const current = map.get(key) || [];
    current.push(value);
    map.set(key, current);
}

function buildViewerIndexes(overlay: VisualOverlayV1): ViewerIndexes {
    const boundariesById = new Map<string, ComponentBoundaryRecord>();
    const boundaryRecordIdByBoundaryId = new Map<string, string>();
    const entryPointsByBoundaryId = new Map<string, EntryPointRecord>();
    const exitPointsByBoundaryId = new Map<string, ExitPointRecord[]>();
    const mountedChildRelationsByParent = new Map<string, MountedChildRelationRecord[]>();
    const mountedChildRelationsById = new Map<string, MountedChildRelationRecord>();
    const continuationMappingsByBoundaryId = new Map<string, BoundaryMappingRecord[]>();
    const continuationMappingsById = new Map<string, BoundaryMappingRecord>();
    const returnMappingsByBoundaryId = new Map<string, BoundaryMappingRecord[]>();
    const returnMappingsById = new Map<string, BoundaryMappingRecord>();
    const contextShellByBoundaryId = new Map<string, ContextShellHintRecord>();
    const traceHintByBoundaryId = new Map<string, TraceProjectionHintRecord>();
    const topologyNodesByBoundaryId = new Map<string, OverlayNodeRecord[]>();
    const topologyEdgesByBoundaryId = new Map<string, OverlayEdgeRecord[]>();
    const flowNodesByBoundaryId = new Map<string, OverlayNodeRecord[]>();
    const flowEdgesByBoundaryId = new Map<string, OverlayEdgeRecord[]>();
    const specificationNodesByBoundaryId = new Map<string, OverlayNodeRecord[]>();
    const specificationEdgesByBoundaryId = new Map<string, OverlayEdgeRecord[]>();
    const dependencyEdgesByBoundaryId = new Map<string, DependencyEdgeRecord[]>();
    const exitPointById = new Map<string, ExitPointRecord>();
    const entryPointById = new Map<string, EntryPointRecord>();

    for (const boundary of overlay.component_boundaries) {
        boundariesById.set(boundary.boundary_id, boundary);
        boundaryRecordIdByBoundaryId.set(boundary.boundary_id, boundary.id);
    }
    for (const entryPoint of overlay.entry_points) {
        entryPointsByBoundaryId.set(entryPoint.boundary_id, entryPoint);
        entryPointById.set(entryPoint.id, entryPoint);
    }
    for (const exitPoint of overlay.exit_points) {
        pushGrouped(exitPointsByBoundaryId, exitPoint.boundary_id, exitPoint);
        exitPointById.set(exitPoint.id, exitPoint);
    }
    for (const relation of overlay.mounted_child_relations) {
        pushGrouped(mountedChildRelationsByParent, relation.parent_boundary_id, relation);
        mountedChildRelationsById.set(relation.id, relation);
    }
    for (const mapping of overlay.continuation_mappings) {
        pushGrouped(continuationMappingsByBoundaryId, mapping.source_boundary_id, mapping);
        continuationMappingsById.set(mapping.id, mapping);
    }
    for (const mapping of overlay.return_mappings) {
        pushGrouped(returnMappingsByBoundaryId, mapping.source_boundary_id, mapping);
        returnMappingsById.set(mapping.id, mapping);
    }
    for (const hint of overlay.context_shell_hints) {
        contextShellByBoundaryId.set(hint.boundary_id, hint);
    }
    for (const hint of overlay.trace_projection_hints) {
        traceHintByBoundaryId.set(hint.boundary_id, hint);
    }
    for (const node of overlay.topology_nodes) {
        if (node.boundary_id) {
            pushGrouped(topologyNodesByBoundaryId, node.boundary_id, node);
        }
    }
    for (const edge of overlay.topology_edges) {
        if (edge.source_boundary_id) {
            pushGrouped(topologyEdgesByBoundaryId, edge.source_boundary_id, edge);
        }
        if (edge.target_boundary_id && edge.target_boundary_id !== edge.source_boundary_id) {
            pushGrouped(topologyEdgesByBoundaryId, edge.target_boundary_id, edge);
        }
    }
    for (const node of overlay.flow_nodes) {
        if (node.boundary_id) {
            pushGrouped(flowNodesByBoundaryId, node.boundary_id, node);
        }
    }
    for (const edge of overlay.flow_edges) {
        if (edge.source_boundary_id) {
            pushGrouped(flowEdgesByBoundaryId, edge.source_boundary_id, edge);
        }
        if (edge.target_boundary_id && edge.target_boundary_id !== edge.source_boundary_id) {
            pushGrouped(flowEdgesByBoundaryId, edge.target_boundary_id, edge);
        }
    }
    for (const node of overlay.specification_nodes) {
        if (node.boundary_id) {
            pushGrouped(specificationNodesByBoundaryId, node.boundary_id, node);
        }
    }
    for (const edge of overlay.specification_edges) {
        if (edge.source_boundary_id) {
            pushGrouped(specificationEdgesByBoundaryId, edge.source_boundary_id, edge);
        }
        if (edge.target_boundary_id && edge.target_boundary_id !== edge.source_boundary_id) {
            pushGrouped(specificationEdgesByBoundaryId, edge.target_boundary_id, edge);
        }
    }
    for (const edge of overlay.dependency_edges) {
        pushGrouped(dependencyEdgesByBoundaryId, edge.source_boundary_id, edge);
    }

    const focusPresence = new Map<ViewerFocusKind, Set<string>>([
        ['boundary', new Set(overlay.component_boundaries.map((entry) => entry.id))],
        ['topology_node', new Set(overlay.topology_nodes.map((entry) => entry.id))],
        ['topology_edge', new Set(overlay.topology_edges.map((entry) => entry.id))],
        ['flow_node', new Set(overlay.flow_nodes.map((entry) => entry.id))],
        ['flow_edge', new Set(overlay.flow_edges.map((entry) => entry.id))],
        ['specification_node', new Set(overlay.specification_nodes.map((entry) => entry.id))],
        ['specification_edge', new Set(overlay.specification_edges.map((entry) => entry.id))],
        ['entry_point', new Set(overlay.entry_points.map((entry) => entry.id))],
        ['exit_point', new Set(overlay.exit_points.map((entry) => entry.id))],
        ['mounted_child_relation', new Set(overlay.mounted_child_relations.map((entry) => entry.id))],
        ['continuation_mapping', new Set(overlay.continuation_mappings.map((entry) => entry.id))],
        ['return_mapping', new Set(overlay.return_mappings.map((entry) => entry.id))],
        ['dependency_edge', new Set(overlay.dependency_edges.map((entry) => entry.id))],
        ['context_shell', new Set(overlay.context_shell_hints.map((entry) => `viewer_context_shell:${toIdSegment(entry.boundary_id)}`))],
        ['trace', new Set(overlay.trace_projection_hints.map((entry) => `viewer_trace:${toIdSegment(entry.boundary_id)}`))],
    ]);

    return {
        boundariesById,
        boundaryRecordIdByBoundaryId,
        entryPointsByBoundaryId,
        exitPointsByBoundaryId,
        mountedChildRelationsByParent,
        mountedChildRelationsById,
        continuationMappingsByBoundaryId,
        continuationMappingsById,
        returnMappingsByBoundaryId,
        returnMappingsById,
        contextShellByBoundaryId,
        traceHintByBoundaryId,
        topologyNodesByBoundaryId,
        topologyEdgesByBoundaryId,
        flowNodesByBoundaryId,
        flowEdgesByBoundaryId,
        specificationNodesByBoundaryId,
        specificationEdgesByBoundaryId,
        dependencyEdgesByBoundaryId,
        exitPointById,
        entryPointById,
        focusPresence,
    };
}

function assertOverlayCompatibility(overlay: VisualOverlayV1, indexes: ViewerIndexes): void {
    if (overlay.meta.schema_id !== OVERLAY_SCHEMA_ID || overlay.meta.schema_version !== OVERLAY_SCHEMA_VERSION) {
        throw new Error('Viewer runtime requires visual overlay schema v1 input.');
    }

    for (const boundary of overlay.component_boundaries) {
        if (!indexes.entryPointsByBoundaryId.has(boundary.boundary_id)) {
            throw new Error(`Viewer runtime missing entry point for boundary '${boundary.boundary_id}'.`);
        }
        if (!indexes.contextShellByBoundaryId.has(boundary.boundary_id)) {
            throw new Error(`Viewer runtime missing context shell hint for boundary '${boundary.boundary_id}'.`);
        }
        if (!indexes.traceHintByBoundaryId.has(boundary.boundary_id)) {
            throw new Error(`Viewer runtime missing trace projection hint for boundary '${boundary.boundary_id}'.`);
        }
    }
}

function getInitialBoundaryId(overlay: VisualOverlayV1, indexes: ViewerIndexes, requestedBoundaryId?: string): string {
    if (requestedBoundaryId) {
        if (!indexes.boundariesById.has(requestedBoundaryId)) {
            throw new Error(`Requested viewer scope boundary '${requestedBoundaryId}' does not exist in overlay.`);
        }
        return requestedBoundaryId;
    }

    const rootBoundary = overlay.component_boundaries.find((entry) => entry.parent_boundary_id === null);
    if (rootBoundary) {
        return rootBoundary.boundary_id;
    }
    if (overlay.component_boundaries[0]) {
        return overlay.component_boundaries[0].boundary_id;
    }
    throw new Error('Viewer runtime requires at least one component boundary in the overlay.');
}

function buildScope(
    indexes: ViewerIndexes,
    boundaryId: string,
    options: {
        callerBoundaryId?: string | null;
        via?: ViewerScopeVia;
        viaPortalKind?: ViewerPortalKind | null;
        viaPortalId?: string | null;
        viaExitPointId?: string | null;
        depth?: number;
    } = {}
): VisualViewerScope {
    const boundary = indexes.boundariesById.get(boundaryId);
    if (!boundary) {
        throw new Error(`Viewer runtime cannot build scope for unknown boundary '${boundaryId}'.`);
    }

    return {
        id: `viewer_scope:${toIdSegment(boundaryId)}`,
        boundary_id: boundaryId,
        parent_boundary_id: boundary.parent_boundary_id,
        caller_boundary_id: options.callerBoundaryId ?? null,
        via: options.via || 'root',
        via_portal_kind: options.viaPortalKind ?? null,
        via_portal_id: options.viaPortalId ?? null,
        via_exit_point_id: options.viaExitPointId ?? null,
        depth: options.depth ?? 0,
    };
}

function buildContextShell(
    indexes: ViewerIndexes,
    boundaryId: string,
    callerBoundaryId: string | null
): VisualViewerContextShell {
    const boundary = indexes.boundariesById.get(boundaryId);
    const entryPoint = indexes.entryPointsByBoundaryId.get(boundaryId);
    const hint = indexes.contextShellByBoundaryId.get(boundaryId);
    const traceHint = indexes.traceHintByBoundaryId.get(boundaryId);
    if (!boundary || !entryPoint || !hint) {
        throw new Error(`Viewer runtime cannot build context shell for boundary '${boundaryId}'.`);
    }

    const mountedChildRelations = sortById(indexes.mountedChildRelationsByParent.get(boundaryId) || []);
    const continuationMappings = sortById(indexes.continuationMappingsByBoundaryId.get(boundaryId) || []);
    const returnMappings = sortById(indexes.returnMappingsByBoundaryId.get(boundaryId) || []);
    const minimapBoundaryIds = Array.from(
        new Set<string>([
            boundaryId,
            ...(boundary.parent_boundary_id ? [boundary.parent_boundary_id] : []),
            ...mountedChildRelations.map((entry) => entry.child_boundary_id),
        ])
    ).sort((a, b) => a.localeCompare(b));

    return {
        id: `viewer_context_shell:${toIdSegment(boundaryId)}`,
        boundary_id: boundaryId,
        caller_boundary_id: callerBoundaryId,
        parent_boundary_id: boundary.parent_boundary_id,
        entry_point_id: entryPoint.id,
        public_exit_point_ids: [...boundary.exit_point_ids].sort((a, b) => a.localeCompare(b)),
        mounted_child_relation_ids: mountedChildRelations.map((entry) => entry.id),
        continuation_target_boundary_ids: continuationMappings.map((entry) => entry.target_boundary_id),
        return_target_boundary_ids: returnMappings.map((entry) => entry.target_boundary_id),
        shell_hint: hint.shell_hint,
        local_role: boundary.local_role,
        current_position_hint: boundary.parent_boundary_id ? 'nested_boundary' : 'root_boundary',
        minimap_boundary_ids: minimapBoundaryIds,
        trace_hint_id: traceHint ? traceHint.id : null,
    };
}

function defaultFocus(indexes: ViewerIndexes, boundaryId: string): VisualViewerFocus {
    const boundaryRecordId = indexes.boundaryRecordIdByBoundaryId.get(boundaryId);
    if (!boundaryRecordId) {
        throw new Error(`Viewer runtime missing boundary focus target for '${boundaryId}'.`);
    }
    return {
        entity_kind: 'boundary',
        entity_id: boundaryRecordId,
        boundary_id: boundaryId,
    };
}

function emptyPeekState(): VisualViewerPeekState {
    return {
        open: false,
        boundary_id: null,
        source_boundary_id: null,
        relation_id: null,
        context_shell_id: null,
    };
}

function emptyTraceState(): VisualViewerTraceState {
    return {
        open: false,
        boundary_id: null,
        entry_point_id: null,
        exit_point_id: null,
        continuation_mapping_ids: [],
        return_mapping_ids: [],
        projection_mode: 'off',
    };
}

function assertFocus(indexes: ViewerIndexes, focus: VisualViewerFocus | null): void {
    if (!focus) {
        return;
    }
    const allowed = indexes.focusPresence.get(focus.entity_kind);
    if (!allowed || !allowed.has(focus.entity_id)) {
        throw new Error(`Viewer runtime cannot focus unknown ${focus.entity_kind} '${focus.entity_id}'.`);
    }
}

function traceForBoundary(indexes: ViewerIndexes, boundaryId: string, exitPointId?: string): VisualViewerTraceState {
    const traceHint = indexes.traceHintByBoundaryId.get(boundaryId);
    if (!traceHint) {
        throw new Error(`Viewer runtime missing trace hint for boundary '${boundaryId}'.`);
    }

    const continuationIds = [...traceHint.continuation_mapping_ids];
    const returnIds = [...traceHint.return_mapping_ids];
    if (!exitPointId) {
        return {
            open: true,
            boundary_id: boundaryId,
            entry_point_id: traceHint.entry_point_id,
            exit_point_id: null,
            continuation_mapping_ids: continuationIds,
            return_mapping_ids: returnIds,
            projection_mode: 'boundary',
        };
    }

    const continuationMappings = continuationIds
        .map((id) => indexes.continuationMappingsById.get(id))
        .filter((entry): entry is BoundaryMappingRecord => Boolean(entry))
        .filter((entry) => entry.source_exit_point_id === exitPointId)
        .map((entry) => entry.id);
    const returnMappings = returnIds
        .map((id) => indexes.returnMappingsById.get(id))
        .filter((entry): entry is BoundaryMappingRecord => Boolean(entry))
        .filter((entry) => entry.source_exit_point_id === exitPointId)
        .map((entry) => entry.id);

    return {
        open: true,
        boundary_id: boundaryId,
        entry_point_id: traceHint.entry_point_id,
        exit_point_id: exitPointId,
        continuation_mapping_ids: continuationMappings,
        return_mapping_ids: returnMappings,
        projection_mode: 'exit',
    };
}

function buildState(
    overlay: VisualOverlayV1,
    indexes: ViewerIndexes,
    scope: VisualViewerScope,
    lod: ViewerLod,
    focus: VisualViewerFocus | null,
    navigationStack: VisualViewerNavigationFrame[],
    peek: VisualViewerPeekState,
    traceState: VisualViewerTraceState
): VisualViewerRuntimeStateV1 {
    assertFocus(indexes, focus);
    const contextShell = buildContextShell(indexes, scope.boundary_id, scope.caller_boundary_id);

    return {
        meta: {
            schema_id: VIEWER_RUNTIME_SCHEMA_ID,
            schema_version: VIEWER_RUNTIME_SCHEMA_VERSION,
            overlay_schema_id: overlay.meta.schema_id,
            overlay_schema_version: overlay.meta.schema_version,
            viewer_authority_ref: VIEWER_RUNTIME_AUTHORITY_REF,
            overlay_boundary_count: overlay.component_boundaries.length,
            overlay_source: overlay.meta.source,
        },
        current_scope: scope,
        current_lod: lod,
        focus,
        context_shell: contextShell,
        peek,
        navigation_stack: navigationStack,
        trace_state: traceState,
    };
}

function pushNavigationFrame(state: VisualViewerRuntimeStateV1): VisualViewerNavigationFrame[] {
    return [
        ...state.navigation_stack,
        {
            id: `viewer_history:${state.navigation_stack.length}:${toIdSegment(state.current_scope.boundary_id)}`,
            scope: { ...state.current_scope },
            lod: state.current_lod,
            focus: state.focus ? { ...state.focus } : null,
            peek: { ...state.peek },
            trace_state: {
                ...state.trace_state,
                continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                return_mapping_ids: [...state.trace_state.return_mapping_ids],
            },
            order_index: state.navigation_stack.length,
        },
    ];
}

function resolveMountedChildRelation(
    indexes: ViewerIndexes,
    sourceBoundaryId: string,
    targetBoundaryId: string,
    relationId?: string
): MountedChildRelationRecord {
    if (relationId) {
        const relation = indexes.mountedChildRelationsById.get(relationId);
        if (!relation || relation.parent_boundary_id !== sourceBoundaryId || relation.child_boundary_id !== targetBoundaryId) {
            throw new Error(`Viewer runtime cannot peek mounted child '${targetBoundaryId}' from '${sourceBoundaryId}'.`);
        }
        return relation;
    }

    const relation = (indexes.mountedChildRelationsByParent.get(sourceBoundaryId) || []).find(
        (entry) => entry.child_boundary_id === targetBoundaryId
    );
    if (!relation) {
        throw new Error(`Viewer runtime cannot enter boundary '${targetBoundaryId}' without an explicit mounted child relation from '${sourceBoundaryId}'.`);
    }
    return relation;
}

function resolvePortal(
    indexes: ViewerIndexes,
    sourceBoundaryId: string,
    action: Extract<VisualViewerAction, { type: 'enter' }>
): { targetBoundaryId: string; portalKind: ViewerPortalKind; portalId: string; viaExitPointId: string | null } {
    const portalKind = action.portal_kind || 'mounted_child_relation';
    if (portalKind === 'mounted_child_relation') {
        const relation = resolveMountedChildRelation(indexes, sourceBoundaryId, action.target_boundary_id, action.portal_id);
        return {
            targetBoundaryId: relation.child_boundary_id,
            portalKind,
            portalId: relation.id,
            viaExitPointId: null,
        };
    }

    if (!action.portal_id) {
        throw new Error(`Viewer runtime enter action for ${portalKind} must declare portal_id.`);
    }

    const mapping =
        portalKind === 'continuation'
            ? indexes.continuationMappingsById.get(action.portal_id)
            : indexes.returnMappingsById.get(action.portal_id);
    if (!mapping || mapping.source_boundary_id !== sourceBoundaryId || mapping.target_boundary_id !== action.target_boundary_id) {
        throw new Error(`Viewer runtime cannot enter boundary '${action.target_boundary_id}' through invalid ${portalKind} portal '${action.portal_id}'.`);
    }
    return {
        targetBoundaryId: mapping.target_boundary_id,
        portalKind,
        portalId: mapping.id,
        viaExitPointId: mapping.source_exit_point_id,
    };
}

export function createVisualViewerState(
    overlay: VisualOverlayV1,
    options: {
        boundary_id?: string;
        lod?: ViewerLod;
        focus?: VisualViewerFocus | null;
    } = {}
): VisualViewerRuntimeStateV1 {
    const indexes = buildViewerIndexes(overlay);
    assertOverlayCompatibility(overlay, indexes);
    const boundaryId = getInitialBoundaryId(overlay, indexes, options.boundary_id);
    const scope = buildScope(indexes, boundaryId);
    return buildState(
        overlay,
        indexes,
        scope,
        options.lod || 'topology',
        options.focus === undefined ? defaultFocus(indexes, boundaryId) : options.focus,
        [],
        emptyPeekState(),
        emptyTraceState()
    );
}

export function reduceVisualViewerState(
    overlay: VisualOverlayV1,
    state: VisualViewerRuntimeStateV1,
    action: VisualViewerAction
): VisualViewerRuntimeStateV1 {
    const indexes = buildViewerIndexes(overlay);
    assertOverlayCompatibility(overlay, indexes);

    switch (action.type) {
        case 'change_lod':
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                action.lod,
                state.focus ? { ...state.focus } : null,
                [...state.navigation_stack],
                { ...state.peek },
                {
                    ...state.trace_state,
                    continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                    return_mapping_ids: [...state.trace_state.return_mapping_ids],
                }
            );
        case 'set_focus':
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                state.current_lod,
                action.focus ? { ...action.focus } : null,
                [...state.navigation_stack],
                { ...state.peek },
                {
                    ...state.trace_state,
                    continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                    return_mapping_ids: [...state.trace_state.return_mapping_ids],
                }
            );
        case 'peek': {
            const relation = resolveMountedChildRelation(
                indexes,
                state.current_scope.boundary_id,
                action.target_boundary_id,
                action.relation_id
            );
            const peekBoundaryShell = buildContextShell(indexes, relation.child_boundary_id, state.current_scope.boundary_id);
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                state.current_lod,
                state.focus ? { ...state.focus } : null,
                [...state.navigation_stack],
                {
                    open: true,
                    boundary_id: relation.child_boundary_id,
                    source_boundary_id: state.current_scope.boundary_id,
                    relation_id: relation.id,
                    context_shell_id: peekBoundaryShell.id,
                },
                {
                    ...state.trace_state,
                    continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                    return_mapping_ids: [...state.trace_state.return_mapping_ids],
                }
            );
        }
        case 'enter': {
            const portal = resolvePortal(indexes, state.current_scope.boundary_id, action);
            const nextScope = buildScope(indexes, portal.targetBoundaryId, {
                callerBoundaryId: state.current_scope.boundary_id,
                via: 'enter',
                viaPortalKind: portal.portalKind,
                viaPortalId: portal.portalId,
                viaExitPointId: portal.viaExitPointId,
                depth: state.current_scope.depth + 1,
            });
            return buildState(
                overlay,
                indexes,
                nextScope,
                state.current_lod,
                defaultFocus(indexes, portal.targetBoundaryId),
                pushNavigationFrame(state),
                emptyPeekState(),
                emptyTraceState()
            );
        }
        case 'up': {
            if (!state.current_scope.parent_boundary_id) {
                throw new Error(`Viewer runtime cannot move up from root boundary '${state.current_scope.boundary_id}'.`);
            }
            const targetBoundaryId = state.current_scope.parent_boundary_id;
            const nextScope = buildScope(indexes, targetBoundaryId, {
                callerBoundaryId: state.current_scope.boundary_id,
                via: 'up',
                depth: Math.max(0, state.current_scope.depth - 1),
            });
            return buildState(
                overlay,
                indexes,
                nextScope,
                state.current_lod,
                defaultFocus(indexes, targetBoundaryId),
                pushNavigationFrame(state),
                emptyPeekState(),
                emptyTraceState()
            );
        }
        case 'back': {
            if (state.peek.open) {
                return buildState(
                    overlay,
                    indexes,
                    { ...state.current_scope },
                    state.current_lod,
                    state.focus ? { ...state.focus } : null,
                    [...state.navigation_stack],
                    emptyPeekState(),
                    {
                        ...state.trace_state,
                        continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                        return_mapping_ids: [...state.trace_state.return_mapping_ids],
                    }
                );
            }
            if (state.navigation_stack.length === 0) {
                throw new Error(`Viewer runtime cannot go back from boundary '${state.current_scope.boundary_id}' with an empty navigation stack.`);
            }
            const previous = state.navigation_stack[state.navigation_stack.length - 1];
            return buildState(
                overlay,
                indexes,
                { ...previous.scope },
                previous.lod,
                previous.focus ? { ...previous.focus } : null,
                state.navigation_stack.slice(0, -1),
                { ...previous.peek },
                {
                    ...previous.trace_state,
                    continuation_mapping_ids: [...previous.trace_state.continuation_mapping_ids],
                    return_mapping_ids: [...previous.trace_state.return_mapping_ids],
                }
            );
        }
        case 'open_trace': {
            const boundaryId = action.boundary_id || state.current_scope.boundary_id;
            const traceState = traceForBoundary(indexes, boundaryId, action.exit_point_id);
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                state.current_lod,
                action.exit_point_id
                    ? {
                          entity_kind: 'trace',
                          entity_id: `viewer_trace:${toIdSegment(boundaryId)}`,
                          boundary_id: boundaryId,
                      }
                    : state.focus
                      ? { ...state.focus }
                      : defaultFocus(indexes, state.current_scope.boundary_id),
                [...state.navigation_stack],
                { ...state.peek },
                traceState
            );
        }
        case 'close_trace':
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                state.current_lod,
                state.focus ? { ...state.focus } : null,
                [...state.navigation_stack],
                { ...state.peek },
                emptyTraceState()
            );
        case 'center_on_entry': {
            const entryPointId = action.entry_point_id || state.context_shell.entry_point_id;
            const entryPoint = indexes.entryPointById.get(entryPointId);
            if (!entryPoint || entryPoint.boundary_id !== state.current_scope.boundary_id) {
                throw new Error(`Viewer runtime cannot center on entry '${entryPointId}' outside the current scope '${state.current_scope.boundary_id}'.`);
            }
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                state.current_lod,
                {
                    entity_kind: 'entry_point',
                    entity_id: entryPointId,
                    boundary_id: state.current_scope.boundary_id,
                },
                [...state.navigation_stack],
                { ...state.peek },
                {
                    ...state.trace_state,
                    continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                    return_mapping_ids: [...state.trace_state.return_mapping_ids],
                }
            );
        }
        case 'center_on_exit': {
            const exitPoint = indexes.exitPointById.get(action.exit_point_id);
            if (!exitPoint || exitPoint.boundary_id !== state.current_scope.boundary_id) {
                throw new Error(`Viewer runtime cannot center on exit '${action.exit_point_id}' outside the current scope '${state.current_scope.boundary_id}'.`);
            }
            return buildState(
                overlay,
                indexes,
                { ...state.current_scope },
                state.current_lod,
                {
                    entity_kind: 'exit_point',
                    entity_id: action.exit_point_id,
                    boundary_id: state.current_scope.boundary_id,
                },
                [...state.navigation_stack],
                { ...state.peek },
                {
                    ...state.trace_state,
                    continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
                    return_mapping_ids: [...state.trace_state.return_mapping_ids],
                }
            );
        }
    }
}

export function deriveVisualViewerFrame(
    overlay: VisualOverlayV1,
    state: VisualViewerRuntimeStateV1
): VisualViewerFrame {
    const indexes = buildViewerIndexes(overlay);
    assertOverlayCompatibility(overlay, indexes);

    const boundaryId = state.current_scope.boundary_id;
    const boundary = indexes.boundariesById.get(boundaryId);
    if (!boundary) {
        throw new Error(`Viewer runtime cannot derive frame for unknown boundary '${boundaryId}'.`);
    }

    const childRelations = sortById(indexes.mountedChildRelationsByParent.get(boundaryId) || []);
    const childBoundaryIds = childRelations.map((entry) => entry.child_boundary_id);
    const topologyBoundaryIds = Array.from(
        new Set<string>([
            boundaryId,
            ...(boundary.parent_boundary_id ? [boundary.parent_boundary_id] : []),
            ...childBoundaryIds,
        ])
    );

    const topologyNodes = sortById(
        topologyBoundaryIds.flatMap((id) => indexes.topologyNodesByBoundaryId.get(id) || [])
    );
    const topologyEdges = sortById(
        topologyBoundaryIds.flatMap((id) => indexes.topologyEdgesByBoundaryId.get(id) || [])
    ).filter(
        (edge, index, items) =>
            items.findIndex((candidate) => candidate.id === edge.id) === index
    );

    const flowNodes = sortById(indexes.flowNodesByBoundaryId.get(boundaryId) || []);
    const flowEdges = sortById(indexes.flowEdgesByBoundaryId.get(boundaryId) || []).filter(
        (edge, index, items) => items.findIndex((candidate) => candidate.id === edge.id) === index
    );
    const specificationNodes = sortById(indexes.specificationNodesByBoundaryId.get(boundaryId) || []);
    const specificationEdges = sortById(indexes.specificationEdgesByBoundaryId.get(boundaryId) || []).filter(
        (edge, index, items) => items.findIndex((candidate) => candidate.id === edge.id) === index
    );
    const entryPoints = indexes.entryPointsByBoundaryId.get(boundaryId)
        ? [indexes.entryPointsByBoundaryId.get(boundaryId) as EntryPointRecord]
        : [];
    const exitPoints = sortById(indexes.exitPointsByBoundaryId.get(boundaryId) || []);
    const continuationMappings = sortById(indexes.continuationMappingsByBoundaryId.get(boundaryId) || []);
    const returnMappings = sortById(indexes.returnMappingsByBoundaryId.get(boundaryId) || []);
    const dependencyEdges = sortById(indexes.dependencyEdgesByBoundaryId.get(boundaryId) || []);

    return {
        scope_boundary_id: boundaryId,
        lod: state.current_lod,
        focus: state.focus ? { ...state.focus } : null,
        context_shell: { ...state.context_shell },
        peek: { ...state.peek },
        trace_state: {
            ...state.trace_state,
            continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
            return_mapping_ids: [...state.trace_state.return_mapping_ids],
        },
        visible: {
            topology_nodes: topologyNodes,
            topology_edges: topologyEdges,
            flow_nodes: flowNodes,
            flow_edges: flowEdges,
            specification_nodes: specificationNodes,
            specification_edges: specificationEdges,
            entry_points: entryPoints,
            exit_points: exitPoints,
            mounted_child_relations: childRelations,
            continuation_mappings: continuationMappings,
            return_mappings: returnMappings,
            dependency_edges: dependencyEdges,
        },
        portal_targets: {
            enter_boundary_ids: [...childBoundaryIds].sort((a, b) => a.localeCompare(b)),
            peek_boundary_ids: [...childBoundaryIds].sort((a, b) => a.localeCompare(b)),
            up_boundary_id: boundary.parent_boundary_id,
            can_back: state.peek.open || state.navigation_stack.length > 0,
        },
    };
}

export function normalizeViewerStateForComparison(state: VisualViewerRuntimeStateV1): VisualViewerRuntimeStateV1 {
    return {
        ...state,
        navigation_stack: state.navigation_stack.map((frame) => ({
            ...frame,
            focus: frame.focus ? { ...frame.focus } : null,
            peek: { ...frame.peek },
            trace_state: {
                ...frame.trace_state,
                continuation_mapping_ids: [...frame.trace_state.continuation_mapping_ids],
                return_mapping_ids: [...frame.trace_state.return_mapping_ids],
            },
        })),
        focus: state.focus ? { ...state.focus } : null,
        context_shell: {
            ...state.context_shell,
            public_exit_point_ids: [...state.context_shell.public_exit_point_ids],
            mounted_child_relation_ids: [...state.context_shell.mounted_child_relation_ids],
            continuation_target_boundary_ids: [...state.context_shell.continuation_target_boundary_ids],
            return_target_boundary_ids: [...state.context_shell.return_target_boundary_ids],
            minimap_boundary_ids: [...state.context_shell.minimap_boundary_ids],
        },
        peek: { ...state.peek },
        trace_state: {
            ...state.trace_state,
            continuation_mapping_ids: [...state.trace_state.continuation_mapping_ids],
            return_mapping_ids: [...state.trace_state.return_mapping_ids],
        },
    };
}
