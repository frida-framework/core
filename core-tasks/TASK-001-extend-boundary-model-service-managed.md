---
id: 001-extend-boundary-model-service-managed
status: OPEN
profile_id: frida_governance
interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
title: Extend component boundary model with service-managed mount kind
summary: Add a service-managed mount kind and the missing classification/guard semantics needed for backend-style component boundaries.
acceptance_criteria:
  - FL11 defines boundary classification criteria and a service-managed mount kind with endpoint semantics.
  - Guard and validation surfaces cover service-managed mount metadata and endpoint/provider validation.
  - FL10 and runtime-facing constants accept service-managed boundaries without UI-slot assumptions.
verification_cmd: npm run build && node dist/cli.js check contract-set
---

# TASK-001: Extend Component Boundary Model with `service-managed` Mount Kind

## Background

The current `component_contract_spec` (FL11) and `visual.ts` support only two `mount_kind` values: `mapper-managed` and `host-static`. Both assume a UI mounting context — a DOM slot where a component is rendered or statically hosted.

Real applications contain backend-independent entities (processing pipelines, service layers, edge function groups) that exhibit all boundary-level properties — independent lifecycle, typed input/output interfaces, internal domain structure, shared dependencies — but have no UI slot. They "mount" into infrastructure endpoints (Supabase project, API gateway, service mesh).

This gap was identified during app-contract migration in `katai-planner`, where `ROUTE_PIPELINE_CONTRACT` is a fully independent entity (removing any UI component does not affect it), yet cannot be declared as a component boundary because `mount_kind` does not support non-UI mounts.

### Session Analysis — Questions That Revealed the Gap

The following questions were raised during the migration session. Each exposes a missing normative principle:

| # | Question | Root Cause |
|---|---|---|
| 1 | "Why boundary model only for wizard/route?" | Contract does not define **what makes an entity a component boundary** in general terms. Agent had to guess by looking at existing UI examples. |
| 2 | "Why no pages?" | Contract does not classify **page-level hosts** as distinct from mounted children. The `host-static` vs `mapper-managed` distinction exists but there is no normative guidance on when to use each. |
| 3 | "Why no pipeline?" | `mount_kind` enum lacks backend/service mount. Pipeline has boundary-level independence but fails `component_mount_point` validation. |
| 4 | "Isn't the mount point of the pipeline Supabase itself? Or the project ID? Or service layer?" | `slotRef` semantics are undefined for non-UI contexts. No guidance on what constitutes a valid mount reference for service-managed components. |

All four questions should be answered by the contract itself, not by session discussion.

---

## Required Changes

### 1. Component Classification Principles (FL11 `component_contract_spec`)

Add a normative `component_classification` subsection that defines when an entity qualifies as a component boundary. Proposed principles:

```yaml
component_classification:
  purpose: "Defines what qualifies as a component boundary vs. what remains a domain block or shared ref."
  boundary_qualifying_criteria:
    - id: independent_lifecycle
      rule: >-
        The entity can be added, removed, or replaced without structurally
        breaking any other declared component boundary.
    - id: typed_interface
      rule: >-
        The entity has a typed inbound contract interface (data it receives)
        and a typed outbound contract interface (exits, events, callbacks it
        produces).
    - id: mount_surface
      rule: >-
        The entity attaches to a declared mount surface — a UI slot, a service
        endpoint, or a host container — through which it becomes reachable.
    - id: internal_domain
      rule: >-
        The entity contains internal domain blocks (structure, behavior, data
        schema, algorithms) that are opaque to its parent until explicit
        drill-in.
  boundary_disqualifying_criteria:
    - id: no_independent_lifecycle
      rule: >-
        If removing the entity necessarily breaks the internal structure of
        another boundary, it is a domain block of that boundary, not a
        separate boundary.
    - id: pure_data_reference
      rule: >-
        If the entity only provides shared data (glossary, schema, resources)
        consumed by multiple boundaries, it is a shared ref target, not a
        boundary.
    - id: internal_substructure_only
      rule: >-
        If the entity exists only as nested detail inside another boundary's
        domain blocks and has no independent mount surface, it remains a
        domain block.
  endpoint_validation:
    purpose: "Endpoints as boundary correctness check."
    rule: >-
      A correctly identified component boundary MUST have at least one
      addressable endpoint — a mount surface through which the boundary is
      entered. If an entity has no addressable endpoint, it cannot be a
      component boundary. The endpoint type determines mount_kind.
    endpoint_types:
      ui_slot:
        mount_kind: [mapper-managed, host-static]
        endpoint_example: "DOM element, route slot, portal target"
      service_endpoint:
        mount_kind: [service-managed]
        endpoint_example: "Supabase project functions, API gateway route, service mesh endpoint"
    cross_check_rule: >-
      If every qualifying criterion is met but no endpoint can be identified,
      the entity is likely a domain block with misleading independence
      characteristics, not a true component boundary.
```

### 2. New `mount_kind: service-managed` (FL11 `component_contract_spec.section_field_rules.component_mount_point`)

Extend the allowed mount_kind vocabulary:

```yaml
component_mount_point:
  required_fields:
    - slotRef
    - mount_kind
  optional_fields:
    - mounted_child_boundaryRefs
    - service_provider     # NEW: required when mount_kind = service-managed
  allowed_mount_kinds:
    - mapper-managed
    - host-static
    - service-managed      # NEW
  mount_kind_semantics:
    mapper-managed:
      description: "Component is structurally adapted and mounted into a UI slot by the mapper build pipeline."
      slotRef_semantics: "References a UI slot defined in PATHS.slots.* or UI_STRUCTURE.*"
      applicable_to: "Frontend components transformed and injected by the mapper."
    host-static:
      description: "Component is statically hosted in a UI container (page, layout) without mapper transformation."
      slotRef_semantics: "References a host container defined in PATHS.slots.* or UI_STRUCTURE.*"
      applicable_to: "Pages, layout containers, static host shells."
    service-managed:
      description: "Component operates as a backend service boundary, attached to an infrastructure endpoint rather than a UI slot."
      slotRef_semantics: "References a service endpoint defined in PATHS.services.*, RESOURCES.*, or environment configuration."
      applicable_to: "Backend pipelines, serverless function groups, service layers, API handler bundles."
      required_fields:
        - service_provider
      service_provider_rule: >-
        When mount_kind=service-managed, component_mount_point MUST declare
        service_provider identifying the infrastructure platform or runtime
        (e.g., 'supabase', 'cloudflare-workers', 'express-router').
```

### 3. Update `visual.ts` Constants

```typescript
const ALLOWED_MOUNT_KINDS = ['mapper-managed', 'host-static', 'service-managed'] as const;
```

No other changes in `visual.ts` should be needed — the projection logic is already mount_kind-agnostic after validation.

### 4. Update Guards (FL11 `FRIDA_GUARD_SPEC`)

Add guard:

```yaml
- id: component_service_managed_provider_missing
  text: "mount_kind=service-managed is declared but service_provider is missing."
```

### 5. Update Validation Checklist (FL06 `FRIDA_VALIDATION_CHECKLIST`)

Add to `visual_consistency`:

```yaml
- "service-managed mount points declare service_provider and reference a valid service endpoint."
```

### 6. Update FL10 Visualization Projection

`component_mount_point` mapping_rules.topology must account for service-managed:

```yaml
component_mount_point:
  topology:
    entry_boundary: "Projects the current component boundary entry anchor at slotRef."
    mounted_child_boundaries: "Each mounted_child_boundaryRefs entry projects a mounted child boundary anchor."
    mount_transition: "Each mounted child boundary anchor projects a mount transition from the current component boundary entry anchor."
    service_boundary: "For service-managed components, projects a service boundary anchor distinct from UI host anchors."
```

### 7. Example — Service-Managed Component Contract

```yaml
ROUTE_PIPELINE:
  component_hierarchy_position:
    parent_boundaryRef: "APP_HOST_ROOT"
    local_role: "service_backend"
  component_mount_point:
    slotRef: "RESOURCES.supabase.projectEndpoint"
    mount_kind: "service-managed"
    service_provider: "supabase"
  component_input_interface:
    route_id: "string (UUID)"
    skeleton_raw: "object"
  component_output_interface:
    exits:
      - id: "pipeline_complete"
        outcome: "exit"
      - id: "pipeline_error"
        outcome: "exit"
  component_domain_blocks:
    route_generation:
      projection_domains:
        - flow
      purpose: "Route generation pipeline stages"
    waypoint_validation:
      projection_domains:
        - specification
      purpose: "Waypoint detection and mapbox validation algorithms"
    segment_analysis:
      projection_domains:
        - specification
      purpose: "Segment beauty/complexity analysis"
  component_shared_refs:
    refs:
      - "DATABASE_SCHEMA.routes"
      - "RESOURCES.mapboxDirections"
      - "GLOSSARY.skeleton"
```

---

## Affected Contract Layers

| Layer | Block | Change |
|---|---|---|
| FL11 | `component_contract_spec` | Add `component_classification`, extend `allowed_mount_kinds`, add `service_provider` field rules, add example |
| FL11 | `FRIDA_GUARD_SPEC` | Add `component_service_managed_provider_missing` guard |
| FL10 | `FRIDA_VISUAL.component_projection.mapping_rules.component_mount_point` | Add `service_boundary` projection rule |
| FL06 | `FRIDA_VALIDATION_CHECKLIST.visual_consistency` | Add service-managed validation item |
| `src/visual.ts` | `ALLOWED_MOUNT_KINDS` | Add `'service-managed'` |

## Verification

```bash
npm run build                           # TypeScript compiles
node dist/cli.js check contract-set     # Contract set passes
npm test                                # If tests exist
```

After contract update, run visual pipeline against updated katai-planner app contract that declares a `service-managed` boundary for `ROUTE_PIPELINE`:

```bash
cd /mnt/c/projectMSI/katai-planner && npx frida-core visual
```
