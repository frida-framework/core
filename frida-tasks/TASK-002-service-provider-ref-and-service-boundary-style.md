# TASK-002: Formalize `service_providerRef` and Minimal Service Boundary Visual Semantics

interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
profile_id: frida_governance

## Objective

Finalize TASK-001 by making two clarifications normative:

1. `service_provider` is not a core-enum; it is an application-contract entity declared once and referenced.
2. `service_boundary` must be visually distinct from UI anchors now (style-level distinction is enough for this stage).

---

## Required Changes

### 1. Replace free-form provider with `service_providerRef`

In FL11 `component_contract_spec.section_field_rules.component_mount_point`:

- For `mount_kind: service-managed`, require `service_providerRef`.
- `service_providerRef` MUST resolve to an app-contract registry object (recommended `SERVICE_PROVIDERS.*`).
- `service_providerRef` is a reference field, not free text.

Proposed shape:

```yaml
component_mount_point:
  required_fields:
    - slotRef
    - mount_kind
  optional_fields:
    - mounted_child_boundaryRefs
    - service_providerRef
  mount_kind_semantics:
    service-managed:
      required_fields:
        - service_providerRef
      service_provider_rule: >-
        When mount_kind=service-managed, service_providerRef MUST resolve to
        SERVICE_PROVIDERS.* in the application contract.
```

### 2. Add guards for reference consistency

In FL11 `FRIDA_GUARD_SPEC`, ensure both guards exist:

```yaml
- id: component_service_managed_provider_missing
  text: "mount_kind=service-managed is declared but service_providerRef is missing."

- id: component_service_provider_ref_unresolved
  text: "service_providerRef does not resolve to a declared application service provider."
```

### 3. Validation checklist update

In FL06 `FRIDA_VALIDATION_CHECKLIST.visual_consistency`, add:

```yaml
- "service-managed mount points declare service_providerRef and it resolves to SERVICE_PROVIDERS.*"
- "service-managed boundaries project a service-type anchor with service style token/class."
```

### 4. FL10 minimal visual distinction (style is sufficient)

In FL10 `FRIDA_VISUAL.component_projection.mapping_rules.component_mount_point`:

- Keep `service_boundary` topology rule.
- Add a minimal style contract to distinguish service anchors from UI anchors.

Suggested contract language:

```yaml
component_mount_point:
  topology:
    service_boundary: "For service-managed components, projects a service boundary anchor distinct from UI host anchors."
  style_semantics:
    service_boundary:
      anchor_kind: "service"
      style_token: "anchor.service"
      note: "Visual distinction is required at style level; deeper rendering optimization may be added later."
```

---

## Notes

- Do not introduce a closed core-level enum of providers.
- App contracts may define single-instance or custom providers specific to one project.
- Keep diff minimal; legacy refactor is out of scope.

## Verification

```bash
npm run build && node dist/cli.js check contract-set && npm test
```
