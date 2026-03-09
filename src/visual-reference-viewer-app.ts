import {
    createVisualViewerState,
    deriveVisualViewerFrame,
    reduceVisualViewerState,
} from './visual-viewer.ts';
import type { VisualOverlayV1 } from './visual.ts';
import type {
    VisualViewerAction,
    VisualViewerFocus,
    VisualViewerFrame,
    VisualViewerRuntimeStateV1,
} from './visual-viewer.ts';

declare const document: any;

function escapeHtml(value: unknown): string {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toLabel(value: string): string {
    return value.replace(/_/g, ' ');
}

function findFocusedEntity(overlay: VisualOverlayV1, state: VisualViewerRuntimeStateV1): unknown {
    const focus = state.focus;
    if (!focus) {
        return null;
    }

    if (focus.entity_kind === 'context_shell') {
        return state.context_shell;
    }
    if (focus.entity_kind === 'trace') {
        return state.trace_state;
    }

    const pools: Record<string, unknown[]> = {
        boundary: overlay.component_boundaries,
        topology_node: overlay.topology_nodes,
        topology_edge: overlay.topology_edges,
        flow_node: overlay.flow_nodes,
        flow_edge: overlay.flow_edges,
        specification_node: overlay.specification_nodes,
        specification_edge: overlay.specification_edges,
        entry_point: overlay.entry_points,
        exit_point: overlay.exit_points,
        mounted_child_relation: overlay.mounted_child_relations,
        continuation_mapping: overlay.continuation_mappings,
        return_mapping: overlay.return_mappings,
        dependency_edge: overlay.dependency_edges,
    };

    const pool = pools[focus.entity_kind] || [];
    return pool.find((entry) => typeof entry === 'object' && entry !== null && (entry as { id?: string }).id === focus.entity_id) || null;
}

function focusAttrs(kind: string, id: string, boundaryId: string | null = null): string {
    const attrs = [
        'type="button"',
        'class="entity-button"',
        `data-action="focus"`,
        `data-focus-kind="${escapeHtml(kind)}"`,
        `data-focus-id="${escapeHtml(id)}"`,
    ];
    if (boundaryId) {
        attrs.push(`data-boundary-id="${escapeHtml(boundaryId)}"`);
    }
    return attrs.join(' ');
}

function actionButton(label: string, attrs: string, tone = ''): string {
    const className = tone ? `action-button ${tone}` : 'action-button';
    return `<button type="button" class="${className}" ${attrs}>${escapeHtml(label)}</button>`;
}

function renderEntityList(
    title: string,
    items: Array<{
        id: string;
        label: string;
        kind: string;
        boundaryId?: string | null;
        meta?: string;
        extraActions?: string;
    }>
): string {
    return `
      <section class="panel">
        <h3>${escapeHtml(title)}</h3>
        <div class="entity-list">
          ${items.length === 0
              ? '<p class="muted">None in current scope.</p>'
              : items
                    .map(
                        (item) => `
                <div class="entity-card">
                  <div class="entity-main">
                    <button ${focusAttrs(item.kind, item.id, item.boundaryId || null)}>
                      <strong>${escapeHtml(item.label)}</strong>
                    </button>
                    ${item.meta ? `<p class="entity-meta">${escapeHtml(item.meta)}</p>` : ''}
                  </div>
                  ${item.extraActions ? `<div class="entity-actions">${item.extraActions}</div>` : ''}
                </div>
              `
                    )
                    .join('')}
        </div>
      </section>
    `;
}

function renderTopology(frame: VisualViewerFrame): string {
    const portalCards = frame.visible.mounted_child_relations.map((relation) => ({
        id: relation.id,
        label: `${relation.parent_boundary_id} -> ${relation.child_boundary_id}`,
        kind: 'mounted_child_relation',
        boundaryId: relation.parent_boundary_id,
        meta: 'Explicit boundary portal',
        extraActions: [
            actionButton(
                'Peek',
                `data-action="peek" data-target-boundary-id="${escapeHtml(relation.child_boundary_id)}" data-relation-id="${escapeHtml(relation.id)}"`
            ),
            actionButton(
                'Enter',
                `data-action="enter-mounted-child" data-target-boundary-id="${escapeHtml(relation.child_boundary_id)}" data-relation-id="${escapeHtml(relation.id)}"`,
                'primary'
            ),
        ].join(''),
    }));

    return `
      ${renderEntityList(
          'Topology Nodes',
          frame.visible.topology_nodes.map((node) => ({
              id: node.id,
              label: node.label,
              kind: 'topology_node',
              boundaryId: node.boundary_id,
              meta: `${node.kind}${node.boundary_id ? ` · boundary ${node.boundary_id}` : ''}`,
          }))
      )}
      ${renderEntityList(
          'Topology Edges',
          frame.visible.topology_edges.map((edge) => ({
              id: edge.id,
              label: `${edge.kind}: ${edge.source_id} -> ${edge.target_id}`,
              kind: 'topology_edge',
              boundaryId: edge.source_boundary_id,
              meta: edge.source_path,
          }))
      )}
      ${renderEntityList('Mounted Child Portals', portalCards)}
    `;
}

function renderFlow(frame: VisualViewerFrame): string {
    const flowNodes = frame.visible.flow_nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: 'flow_node',
        boundaryId: node.boundary_id,
        meta: `${node.kind} · ${node.source_path}`,
    }));
    const flowEdges = frame.visible.flow_edges.map((edge) => ({
        id: edge.id,
        label: `${edge.kind}: ${edge.source_id} -> ${edge.target_id}`,
        kind: 'flow_edge',
        boundaryId: edge.source_boundary_id,
        meta: edge.source_path,
    }));
    const exits = frame.visible.exit_points.map((exitPoint) => {
        const actions = [
            actionButton(
                'Center',
                `data-action="center-on-exit" data-exit-point-id="${escapeHtml(exitPoint.id)}"`
            ),
            actionButton(
                'Trace',
                `data-action="trace-exit" data-exit-point-id="${escapeHtml(exitPoint.id)}"`,
                'secondary'
            ),
        ];
        return {
            id: exitPoint.id,
            label: `${exitPoint.exit_id} (${exitPoint.outcome})`,
            kind: 'exit_point',
            boundaryId: exitPoint.boundary_id,
            meta:
                exitPoint.continuation_target_boundary_id
                    ? `continue -> ${exitPoint.continuation_target_boundary_id}`
                    : exitPoint.return_target_boundary_id
                      ? `return -> ${exitPoint.return_target_boundary_id}`
                      : 'terminal exit',
            extraActions: actions.join(''),
        };
    });
    const continuationCards = frame.visible.continuation_mappings.map((mapping) => ({
        id: mapping.id,
        label: `${mapping.source_boundary_id} -> ${mapping.target_boundary_id}`,
        kind: 'continuation_mapping',
        boundaryId: mapping.source_boundary_id,
        meta: `Exit ${mapping.source_exit_point_id}`,
        extraActions: actionButton(
            'Enter Target',
            `data-action="enter-continuation" data-target-boundary-id="${escapeHtml(mapping.target_boundary_id)}" data-mapping-id="${escapeHtml(mapping.id)}"`,
            'primary'
        ),
    }));
    const returnCards = frame.visible.return_mappings.map((mapping) => ({
        id: mapping.id,
        label: `${mapping.source_boundary_id} -> ${mapping.target_boundary_id}`,
        kind: 'return_mapping',
        boundaryId: mapping.source_boundary_id,
        meta: `Return via ${mapping.source_exit_point_id}`,
        extraActions: actionButton(
            'Enter Target',
            `data-action="enter-return" data-target-boundary-id="${escapeHtml(mapping.target_boundary_id)}" data-mapping-id="${escapeHtml(mapping.id)}"`,
            'primary'
        ),
    }));

    return `
      <section class="panel">
        <h3>Flow Controls</h3>
        <div class="inline-actions">
          ${actionButton('Center Entry', 'data-action="center-on-entry"')}
          ${actionButton('Trace Boundary', 'data-action="trace-boundary"')}
        </div>
      </section>
      ${renderEntityList('Flow Nodes', flowNodes)}
      ${renderEntityList('Flow Edges', flowEdges)}
      ${renderEntityList('Exit Points', exits)}
      ${renderEntityList('Continuation Targets', continuationCards)}
      ${renderEntityList('Return Targets', returnCards)}
    `;
}

function renderSpecification(frame: VisualViewerFrame): string {
    return `
      <section class="panel notice-panel">
        <h3>Boundary-Local Specification</h3>
        <p>Specification view is locked to the current boundary. Mounted child internals stay collapsed until explicit enter.</p>
      </section>
      ${renderEntityList(
          'Specification Nodes',
          frame.visible.specification_nodes.map((node) => ({
              id: node.id,
              label: node.label,
              kind: 'specification_node',
              boundaryId: node.boundary_id,
              meta: `${node.kind} · ${node.source_path}`,
          }))
      )}
      ${renderEntityList(
          'Specification Edges',
          frame.visible.specification_edges.map((edge) => ({
              id: edge.id,
              label: `${edge.kind}: ${edge.source_id} -> ${edge.target_id}`,
              kind: 'specification_edge',
              boundaryId: edge.source_boundary_id,
              meta: edge.source_path,
          }))
      )}
      ${renderEntityList(
          'Dependency Edges',
          frame.visible.dependency_edges.map((edge) => ({
              id: edge.id,
              label: `${edge.target_ref}`,
              kind: 'dependency_edge',
              boundaryId: edge.source_boundary_id,
              meta: `dependency from ${edge.source_node_id}`,
          }))
      )}
    `;
}

function renderTrace(state: VisualViewerRuntimeStateV1): string {
    if (!state.trace_state.open) {
        return `<section class="panel"><h3>Trace</h3><p class="muted">Trace is closed.</p></section>`;
    }
    return `
      <section class="panel trace-panel">
        <div class="panel-header">
          <h3>Trace</h3>
          ${actionButton('Close Trace', 'data-action="trace-close"')}
        </div>
        <p><strong>Mode:</strong> ${escapeHtml(state.trace_state.projection_mode)}</p>
        <p><strong>Boundary:</strong> ${escapeHtml(state.trace_state.boundary_id || '-')}</p>
        <p><strong>Entry:</strong> ${escapeHtml(state.trace_state.entry_point_id || '-')}</p>
        <p><strong>Exit:</strong> ${escapeHtml(state.trace_state.exit_point_id || '-')}</p>
        <p><strong>Continuation mappings:</strong> ${escapeHtml(state.trace_state.continuation_mapping_ids.join(', ') || '-')}</p>
        <p><strong>Return mappings:</strong> ${escapeHtml(state.trace_state.return_mapping_ids.join(', ') || '-')}</p>
      </section>
    `;
}

function renderPeek(state: VisualViewerRuntimeStateV1): string {
    if (!state.peek.open) {
        return '';
    }
    return `
      <section class="panel peek-panel">
        <div class="panel-header">
          <h3>Peek</h3>
          ${actionButton('Close Peek', 'data-action="back"')}
        </div>
        <p><strong>Preview boundary:</strong> ${escapeHtml(state.peek.boundary_id || '-')}</p>
        <p><strong>From boundary:</strong> ${escapeHtml(state.peek.source_boundary_id || '-')}</p>
        <p><strong>Portal:</strong> ${escapeHtml(state.peek.relation_id || '-')}</p>
        ${state.peek.boundary_id && state.peek.relation_id
            ? actionButton(
                  'Enter Preview Boundary',
                  `data-action="enter-mounted-child" data-target-boundary-id="${escapeHtml(state.peek.boundary_id)}" data-relation-id="${escapeHtml(state.peek.relation_id)}"`,
                  'primary'
              )
            : ''}
      </section>
    `;
}

function renderContextShell(state: VisualViewerRuntimeStateV1): string {
    const shell = state.context_shell;
    return `
      <section class="panel shell-panel">
        <h3>Context Shell</h3>
        <p><strong>Boundary:</strong> ${escapeHtml(shell.boundary_id)}</p>
        <p><strong>Caller:</strong> ${escapeHtml(shell.caller_boundary_id || '-')}</p>
        <p><strong>Parent:</strong> ${escapeHtml(shell.parent_boundary_id || '-')}</p>
        <p><strong>Entry:</strong> ${escapeHtml(shell.entry_point_id)}</p>
        <p><strong>Public exits:</strong> ${escapeHtml(shell.public_exit_point_ids.join(', ') || '-')}</p>
        <p><strong>Continuation hints:</strong> ${escapeHtml(shell.continuation_target_boundary_ids.join(', ') || '-')}</p>
        <p><strong>Return hints:</strong> ${escapeHtml(shell.return_target_boundary_ids.join(', ') || '-')}</p>
        <p><strong>Position:</strong> ${escapeHtml(shell.current_position_hint)}</p>
        <p><strong>Shell hint:</strong> ${escapeHtml(shell.shell_hint || '-')}</p>
        <p><strong>Minimap anchors:</strong> ${escapeHtml(shell.minimap_boundary_ids.join(', ') || '-')}</p>
      </section>
    `;
}

function renderFocusedDetails(overlay: VisualOverlayV1, state: VisualViewerRuntimeStateV1): string {
    const entity = findFocusedEntity(overlay, state);
    return `
      <section class="panel detail-panel">
        <h3>Focus</h3>
        ${
            state.focus
                ? `<p><strong>${escapeHtml(state.focus.entity_kind)}</strong> · ${escapeHtml(state.focus.entity_id)}</p>`
                : '<p class="muted">Nothing selected.</p>'
        }
        <pre>${escapeHtml(JSON.stringify(entity, null, 2) || 'null')}</pre>
      </section>
    `;
}

function renderLayout(container: any, overlay: VisualOverlayV1, state: VisualViewerRuntimeStateV1, title: string): void {
    const frame = deriveVisualViewerFrame(overlay, state);
    const lodButtons = (['topology', 'flow', 'specification'] as const)
        .map((lod) =>
            actionButton(
                toLabel(lod),
                `data-action="change-lod" data-lod="${lod}"`,
                state.current_lod === lod ? 'primary' : ''
            )
        )
        .join('');

    const mainPanel =
        frame.lod === 'topology' ? renderTopology(frame) : frame.lod === 'flow' ? renderFlow(frame) : renderSpecification(frame);

    container.innerHTML = `
      <div class="viewer-shell">
        <style>
          :root {
            color-scheme: light;
            --bg: #f5efe4;
            --panel: #fffaf0;
            --panel-strong: #f0e2c6;
            --ink: #1d1b16;
            --muted: #6a6255;
            --line: #d8c6a4;
            --accent: #8b4c2e;
            --accent-2: #2f6b5f;
            --shadow: rgba(29, 27, 22, 0.08);
          }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Georgia, "Times New Roman", serif; background: radial-gradient(circle at top, #fff7e5, var(--bg)); color: var(--ink); }
          .viewer-shell { min-height: 100vh; padding: 24px; }
          .hero { display: grid; gap: 12px; margin-bottom: 20px; }
          .hero-card, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 12px 32px var(--shadow); padding: 16px; }
          .hero-card { background: linear-gradient(135deg, #fff8ea, #f1dfbb); }
          .hero h1 { margin: 0; font-size: 28px; }
          .hero-meta { display: flex; flex-wrap: wrap; gap: 10px 16px; color: var(--muted); font-size: 14px; }
          .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
          .action-button, .entity-button { border: 1px solid var(--line); border-radius: 999px; background: white; color: var(--ink); padding: 8px 12px; cursor: pointer; font: inherit; text-align: left; }
          .action-button.primary, .entity-button.primary { background: var(--accent); color: white; border-color: var(--accent); }
          .action-button.secondary { background: var(--accent-2); color: white; border-color: var(--accent-2); }
          .action-button:disabled { opacity: 0.45; cursor: default; }
          .layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); gap: 16px; align-items: start; }
          .stack { display: grid; gap: 16px; }
          .panel h3 { margin: 0 0 12px; font-size: 18px; }
          .panel p { margin: 8px 0; }
          .panel-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
          .entity-list { display: grid; gap: 10px; }
          .entity-card { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: rgba(255,255,255,0.7); }
          .entity-main { display: grid; gap: 6px; }
          .entity-card .entity-button { width: 100%; border-radius: 12px; }
          .entity-meta, .muted { color: var(--muted); font-size: 14px; }
          .entity-actions, .inline-actions { display: flex; flex-wrap: wrap; gap: 8px; }
          .notice-panel { background: linear-gradient(135deg, #fffaf0, #f7ecd4); }
          .peek-panel { border-color: var(--accent); }
          .trace-panel { border-color: var(--accent-2); }
          .detail-panel pre { margin: 0; max-height: 420px; overflow: auto; padding: 12px; border-radius: 12px; background: #f3ead8; font-size: 12px; }
          @media (max-width: 980px) {
            .layout { grid-template-columns: 1fr; }
          }
        </style>
        <section class="hero">
          <div class="hero-card">
            <h1>${escapeHtml(title)}</h1>
            <div class="hero-meta">
              <span><strong>Scope:</strong> ${escapeHtml(state.current_scope.boundary_id)}</span>
              <span><strong>LOD:</strong> ${escapeHtml(frame.lod)}</span>
              <span><strong>Caller:</strong> ${escapeHtml(state.context_shell.caller_boundary_id || '-')}</span>
              <span><strong>Overlay:</strong> ${escapeHtml(overlay.meta.source)}</span>
            </div>
          </div>
          <div class="hero-card toolbar">
            ${actionButton('Back', 'data-action="back"', state.navigation_stack.length > 0 || state.peek.open ? '' : '')}
            ${actionButton('Up', 'data-action="up"', state.current_scope.parent_boundary_id ? '' : '')}
            ${lodButtons}
          </div>
        </section>
        <section class="layout">
          <div class="stack">
            ${renderPeek(state)}
            ${mainPanel}
          </div>
          <div class="stack">
            ${renderContextShell(state)}
            ${renderTrace(state)}
            ${renderFocusedDetails(overlay, state)}
          </div>
        </section>
      </div>
    `;

    const backButton = container.querySelector('[data-action="back"]');
    if (backButton && !(state.navigation_stack.length > 0 || state.peek.open)) {
        backButton.setAttribute('disabled', 'disabled');
    }
    const upButton = container.querySelector('[data-action="up"]');
    if (upButton && !state.current_scope.parent_boundary_id) {
        upButton.setAttribute('disabled', 'disabled');
    }
}

export function mountVisualReferenceViewer(
    container: any,
    overlay: VisualOverlayV1,
    options: { title?: string } = {}
): void {
    const title = options.title || 'Frida Visual Overlay Reference Viewer';
    if (!overlay || typeof overlay !== 'object') {
        throw new Error('Reference viewer requires a parsed overlay object.');
    }

    if (!Array.isArray(overlay.component_boundaries) || overlay.component_boundaries.length === 0) {
        container.innerHTML = `
          <div style="padding:24px;font-family:Georgia,serif">
            <h1>${escapeHtml(title)}</h1>
            <p>No component boundaries exist in this overlay yet.</p>
            <p>Generate a real overlay or use a demo fixture overlay to exercise the reference viewer.</p>
          </div>
        `;
        return;
    }

    let state = createVisualViewerState(overlay, {
        boundary_id: overlay.component_boundaries.find((entry) => entry.parent_boundary_id === null)?.boundary_id,
        lod: 'topology',
    });

    const apply = (action: VisualViewerAction): void => {
        state = reduceVisualViewerState(overlay, state, action);
        renderLayout(container, overlay, state, title);
    };

    container.addEventListener('click', (event: any) => {
        const target = event.target?.closest?.('[data-action]');
        if (!target) {
            return;
        }

        const action = target.getAttribute('data-action');
        if (action === 'change-lod') {
            apply({ type: 'change_lod', lod: target.getAttribute('data-lod') });
            return;
        }
        if (action === 'back') {
            apply({ type: 'back' });
            return;
        }
        if (action === 'up') {
            apply({ type: 'up' });
            return;
        }
        if (action === 'peek') {
            apply({
                type: 'peek',
                target_boundary_id: target.getAttribute('data-target-boundary-id'),
                relation_id: target.getAttribute('data-relation-id') || undefined,
            });
            return;
        }
        if (action === 'enter-mounted-child') {
            apply({
                type: 'enter',
                target_boundary_id: target.getAttribute('data-target-boundary-id'),
                portal_kind: 'mounted_child_relation',
                portal_id: target.getAttribute('data-relation-id') || undefined,
            });
            return;
        }
        if (action === 'enter-continuation') {
            apply({
                type: 'enter',
                target_boundary_id: target.getAttribute('data-target-boundary-id'),
                portal_kind: 'continuation',
                portal_id: target.getAttribute('data-mapping-id') || undefined,
            });
            return;
        }
        if (action === 'enter-return') {
            apply({
                type: 'enter',
                target_boundary_id: target.getAttribute('data-target-boundary-id'),
                portal_kind: 'return',
                portal_id: target.getAttribute('data-mapping-id') || undefined,
            });
            return;
        }
        if (action === 'trace-boundary') {
            apply({ type: 'open_trace' });
            return;
        }
        if (action === 'trace-exit') {
            apply({
                type: 'open_trace',
                exit_point_id: target.getAttribute('data-exit-point-id'),
            });
            return;
        }
        if (action === 'trace-close') {
            apply({ type: 'close_trace' });
            return;
        }
        if (action === 'center-on-entry') {
            apply({ type: 'center_on_entry' });
            return;
        }
        if (action === 'center-on-exit') {
            apply({
                type: 'center_on_exit',
                exit_point_id: target.getAttribute('data-exit-point-id'),
            });
            return;
        }
        if (action === 'focus') {
            const focus: VisualViewerFocus = {
                entity_kind: target.getAttribute('data-focus-kind'),
                entity_id: target.getAttribute('data-focus-id'),
                boundary_id: target.getAttribute('data-boundary-id'),
            };
            apply({ type: 'set_focus', focus });
        }
    });

    renderLayout(container, overlay, state, title);
}
