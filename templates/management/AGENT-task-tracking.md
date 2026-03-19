<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Task Tracking Baseline

```yaml
instruction_surface:
  kind: interface_instruction_surface
  interface_refs:
    - FRIDA_INTERFACE_TASK_TRACKING
  repository_scope: target_app_repo_only
  mutation_scope: target_task_status_only
  ownership_model: seed_then_user_owned
```

> Seeded baseline for maintaining the normative task status registry.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_TASK_TRACKING`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_task_status_only`.
- This instruction does **not** authorize editing published task packs.

## Inputs

- Read `tasks/index.yaml`, `tasks/TASK-*.md`, and any relevant validation artifact.
- Read `tasks/sessions/**` only as append-only execution evidence.

## Normalization

- Track one registry entry per task id.
- Normalize status transitions inside `tasks/index.yaml`.

## Triage

- Allowed registry statuses:
  `draft`, `validated`, `ready`, `in_progress`, `blocked`, `done`, `rejected`, `superseded`
- `validated` means contract validation passed, but execution may still wait on prerequisites.
- `ready` means contract validation passed and prerequisites are satisfied.

## Contract Read Requirements

- Read `.frida/contract/app/**` only when task context must be confirmed.
- Do not use `.frida/inbox/app-contract/**`.

## Collision Validation

- Tracking does not replace `contract_collision_scan`.
- Use the latest validation artifact before promoting a task to `validated` or `ready`.

## Task Decomposition Rules

- Preserve one registry entry per immutable task pack.
- Use `supersedes` / `superseded_by` rather than rewriting task packs.

## Publication Rules

- `tasks/index.yaml` is the only normative status registry.
- Required registry fields:
  `id`, `status`, `spec_path`, `validation_artifact`, `latest_session_ref`, `supersedes`, `superseded_by`, `updated_at`
- `tasks/sessions/**` remain telemetry only.

## Status Update Policy

- Never infer current status from narrative session logs alone.
- `tasks/sessions/**` must stay append-only evidence.
- Update `tasks/index.yaml` when validation or execution changes the normative state.

## Halting / Redirect Conditions

- Halt when tracking would mutate `tasks/TASK-*.md`.
- Halt when tracking would use `tasks/sessions/**` as the normative status source.

## Output Schema

- Required report fields: `frida_report`, `profile_id`, `verification`, `summary`
- Required verification: `frida-core check task-set`

Required invariants:

- `task_status_registry_separate_from_sessions`
- `task_pack_immutable`
- `task_session_logs_append_only`

Required rules refs:

- `FRIDA_INTERFACE_TASK_TRACKING`
- `FRIDA_INTERFACE_TASK_VALIDATION`
