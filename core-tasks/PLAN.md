# FRIDA Visualizer Reboot Plan

## Summary

This plan treats the current viewer as non-product and replaces its contract definition, delivery contract, schemas, runtime, and renderer so the primary output is an interactive architecture diagram of the target application.

Locked decisions from this planning pass:
- Primary surface: standalone FRIDA-generated static visualizer
- Primary audience: engineers and architects
- MVP scope: architecture diagram, not diff/archchat/workbench
- Navigation model: boundary-first
- Layout truth: precomputed by generator, not computed in browser
- Migration strategy: breaking change, no v1 compatibility lane

Important constraint:
- The first contract change must be made in the FRIDA source repo at `C:\Projectx1\frida\core-contract`, not in this app repo’s generated `.frida/**`, which is explicitly non-editable.

## Contract First

1. Redefine the visualizer’s target function in `C:\Projectx1\frida\core-contract\layers\FL10-visualization.yaml`.
- Add a normative field at `FRIDA_VISUAL.target_function` with exact wording:
  `Represent the architecture of the target application as an interactive diagram.`
- Replace the current authority-chain wording that limits the surface to `reference-viewer delivery and demo-fixture scope only`.
- Introduce a new surface contract block, named `FRIDA_VISUAL.visualizer_surface_v2`.
- Delete the old `reference_viewer_scope` authority-chain entry and the old `reference_viewer` block in the same breaking change.

2. Make the new surface contract normative, not descriptive.
- `visualizer_surface_v2.authority_rule` must state that the primary surface is a diagram.
- Add a rule that list/card/detail panels are supporting inspector surfaces only and must never be the primary rendering surface.
- Add a rule that the visualizer must remain overlay-driven and must not consume raw contract semantics directly.

3. Update architecture decisions in `C:\Projectx1\frida\core-contract\layers\FL02-architecture.yaml`.
- Extend `CORE-ADR-008` so it explicitly says the primary visual output is an interactive architecture diagram.
- Record that navigation remains boundary-first.
- Record that layout is precomputed during visual generation and shipped as overlay data.
- Record that the browser runtime is rendering and interaction only, not semantic inference or layout computation.

4. Update management/guard language in `C:\Projectx1\frida\core-contract\layers\FL11-management.yaml`.
- Replace the guard text that enforces “reference viewer remains delivery-only”.
- Add a new guard that enforces “diagram-primary rendering”.
- Add a new guard that forbids shipping a visualizer whose primary surface is list/card text instead of node/edge diagram.
- Keep the existing overlay-only and child-non-auto-expand rules.

## Breaking Public Surface Changes

### Contract/API changes

1. Replace overlay v1 with overlay v2, atomically.
- Remove `FRIDA_VISUAL.overlay_entity_model_v1`.
- Remove `FRIDA_VISUAL.overlay_schema_v1`.
- Add `FRIDA_VISUAL.overlay_entity_model_v2`.
- Add `FRIDA_VISUAL.overlay_schema_v2`.
- Update all authority refs to v2 in the same change.

2. Replace viewer runtime v1 with viewer runtime v2, atomically.
- Remove `FRIDA_VISUAL.viewer_runtime_v1`.
- Add `FRIDA_VISUAL.viewer_runtime_v2`.
- Replace `schemas/frida-visual-viewer-runtime.schema.json` with `schemas/frida-visual-viewer-runtime-v2.schema.json`.
- Export the new schema from `C:\Projectx1\frida\package.json`.
- Remove checks that still assert v1 names/refs.

3. Rename product-facing delivery terms.
- Canonical CLI becomes `frida-core visualizer`.
- Canonical FRIDA repo npm script becomes `frida:visualizer`.
- Canonical output path becomes `dist/visualizer/index.html`.
- HTML title becomes `Frida Architecture Visualizer`.
- Do not preserve `visual-viewer` as a supported public command in this plan.

4. Regenerated app-side adoption.
- After publishing the new FRIDA package, update `@sistemado/frida` in `C:\Projectx1\katai-planner`.
- Replace app script `frida:visual:viewer` with `frida:visualizer`.
- Regenerate `.frida/**`; do not patch generated app-side contract files manually.

## Overlay V2 Design

Create a diagram-capable overlay that still preserves the current semantic model but adds precomputed geometry.

### Required top-level overlay v2 structure

- Keep semantic entity families for boundaries, entries, exits, mounted-child relations, continuation mappings, return mappings, dependency edges.
- Add a new top-level `diagram_views` collection.

Each `diagram_view` record must be keyed by:
- `boundary_id`
- `lod`
- `view_id`

Each `diagram_view` must contain:
- `boundary_id`
- `lod`
- `viewport`
- `node_boxes`
- `edge_routes`
- `clusters`
- `ports`
- `label_anchors`
- `z_order`
- `layout_engine`
- `layout_engine_version`
- `layout_config_hash`

### Diagram geometry rules

- Geometry is authoritative for rendering only, never for semantics.
- Semantic source remains the overlay entity model; geometry must reference semantic ids by stable id only.
- Layout must be deterministic for identical input.
- No browser-side force layout, physics, or heuristic repositioning.
- A `diagram_view` exists for every reachable `boundary_id x lod` pair.
- Root startup view is the explicit `host_root` boundary in `topology` LOD when present; otherwise the first root boundary.

### LOD rendering rules

- `topology`: render current boundary plus explicit mounted child boundaries, containment/group boxes, parent relation, dependency edges relevant to current boundary.
- `flow`: render entry point, inbound interface node(s), exit point nodes, continuation/return targets, and typed routing edges for the current boundary.
- `specification`: render current-boundary-only domain blocks and internal sections as a diagram; child internals stay collapsed until explicit enter.

## Viewer Runtime V2 Design

Implement a new runtime contract for interaction over precomputed diagram views.

### Runtime state

The new runtime schema must include:
- `current_scope`
- `current_lod`
- `viewport`
- `selection`
- `hover`
- `context_shell`
- `peek_state`
- `navigation_stack`
- `trace_state`
- `inspector_panel`
- `minimap_state`

### Runtime actions

Required actions:
- `pan`
- `zoom`
- `fit_to_scope`
- `fit_to_selection`
- `change_lod`
- `select_node`
- `select_edge`
- `clear_selection`
- `peek`
- `enter`
- `up`
- `back`
- `open_trace`
- `close_trace`
- `toggle_minimap`

Rules:
- `enter` changes scope only through overlay-declared mounted-child/continuation/return relations.
- `peek` never mutates scope.
- `change_lod` swaps diagram views within the same scope only.
- `selection` drives inspector content but does not imply scope mutation.
- `trace` overlays highlighting on top of the current diagram; it is not a separate non-diagram fallback mode.

## Runtime/Renderer Implementation

Implement the visualizer as an SVG-first renderer in the FRIDA optional visualizer module.

### Technical choices

- Renderer: plain TypeScript + SVG
- No React
- No canvas/WebGL
- Layout engine: ELK in generator time, not in browser time
- Browser interactions: custom pan/zoom/select logic in the module

### File-level implementation target

In `C:\Projectx1\frida\templates/tooling\visualizer\src`:
- Replace `visual-reference-viewer-app.ts` with `visualizer-app.ts`
- Replace the current list/card markup with a diagram canvas + inspector layout
- Keep `visual-viewer.ts` only if it is rewritten to implement runtime v2; otherwise rename it to `visualizer-runtime.ts`
- Replace the HTML generator so it emits `dist/visualizer/index.html`

### UI structure

Main layout:
- Left: primary SVG diagram canvas
- Right: inspector panel with selected node/edge/boundary details
- Top toolbar: breadcrumbs, LOD tabs, fit controls, trace toggle, minimap toggle
- Bottom/overlay: minimap

Primary interactions:
- Click node or edge: select and open inspector
- Double click node or explicit “Enter” action: drill into child boundary
- Wheel/pinch: zoom
- Drag background: pan
- Breadcrumb / Up / Back: boundary-first navigation
- Trace mode: highlight continuation/return/mounted-child routes without leaving the diagram surface

Secondary panels:
- The existing textual entity lists may remain only as debug/inspector sections behind a collapsible “Details” drawer.
- They must not be the default or dominant surface.

## Generator Changes

Implement precomputed layout inside the FRIDA visual generation pipeline.

### Required generator work

In the FRIDA repo:
- Extend the visual builder so `frida-core visual` computes `diagram_views`
- Use ELK with fixed per-LOD configuration
- Persist only stable geometry and routing output
- Fail hard when a semantic entity cannot be placed or routed

### Determinism requirements

- Stable input ordering must produce byte-stable `diagram_views`
- Store `layout_engine`, `layout_engine_version`, and `layout_config_hash` in overlay metadata
- Golden tests must compare geometry as part of overlay determinism
- No volatile geometry fields except explicitly declared ones, and the plan assumes there will be none

## Verification and Test Plan

### Contract/schema checks

Update or replace:
- `C:\Projectx1\frida\templates/tooling\verify\check-visual-contract-consistency.mjs`
- `C:\Projectx1\frida\templates/tooling\verify\check-visual-viewer-runtime.mjs`
- `C:\Projectx1\frida\templates/tooling\verify\check-visual-reference-viewer.mjs`
- `C:\Projectx1\frida\templates/tooling\verify\run-visualizer-module-checks.mjs`

New assertions:
- visualizer target function is present and exact
- surface contract is diagram-primary
- overlay v2 includes `diagram_views`
- viewer runtime v2 includes viewport/selection/minimap state
- generated HTML contains an SVG diagram surface
- primary visible render is nodes/edges, not only panels/lists
- layout output is deterministic

### Fixture scenarios

Must ship/update fixtures for:
- simple leaf boundary
- host root with multiple mounted child boundaries
- parent/child mounted boundary
- continuation routing
- return routing
- one moderately dense app graph with at least 20 nodes to validate pan/zoom/minimap behavior

### Acceptance scenarios

1. Running `frida-core visual` on the template app produces overlay v2 with semantic entities plus precomputed `diagram_views`.
2. Running `frida-core visualizer` produces `dist/visualizer/index.html`.
3. Opening the visualizer starts on the root architecture diagram, not a list-first page.
4. `topology` shows boundary nodes and typed edges as a diagram.
5. `flow` shows boundary-local routing as a diagram.
6. `specification` shows current-boundary internals as a diagram and keeps child internals collapsed.
7. Selecting a node updates the inspector without changing scope.
8. Entering a child boundary changes scope and updates breadcrumbs/back/up correctly.
9. Pan/zoom/minimap operate without recomputing layout.
10. Re-running generation on identical input yields byte-identical overlay output.

## Rollout Sequence

1. FRIDA repo contract rewrite
- edit `core-contract/**`
- regenerate public `contract/**`
- update schemas
- update checks
- update CLI/package exports
- rewrite optional visualizer module
- pass `npm run verify:visual`

2. Publish/update FRIDA package
- publish the breaking version of `@sistemado/frida`
- update any internal docs/examples to use `visualizer`

3. Adopt in `C:\Projectx1\katai-planner`
- bump dependency
- replace `frida:visual:viewer` with `frida:visualizer`
- update wrapper scripts if retained
- regenerate `.frida/**`
- verify `npm run frida:visual` and `npm run frida:visualizer`

## Public Interfaces and Type Changes

- New contract block: `FRIDA_VISUAL.target_function`
- New contract block: `FRIDA_VISUAL.visualizer_surface_v2`
- Replace `overlay_entity_model_v1` with `overlay_entity_model_v2`
- Replace `overlay_schema_v1` with `overlay_schema_v2`
- Replace `viewer_runtime_v1` with `viewer_runtime_v2`
- New schema file: `schemas/frida-visual-overlay-v2.schema.json`
- New schema file: `schemas/frida-visual-viewer-runtime-v2.schema.json`
- New CLI command: `frida-core visualizer`
- New output path: `dist/visualizer/index.html`

## Assumptions and Defaults

- No compatibility layer for v1 surfaces will be maintained.
- The visualizer remains an internal engineering product, not a customer-facing app surface.
- Diff/shadow contract, archchat context, and contract editing are out of scope for MVP.
- The browser runtime is rendering-only plus interaction state; semantic truth and layout truth are both precomputed before delivery.
- SVG is sufficient for target graph size in phase 1.
- The app repo’s generated `.frida/**` remains read-only and must only be updated through FRIDA package regeneration.

