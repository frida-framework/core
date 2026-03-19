<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Task Intake Baseline

```yaml
instruction_surface:
  kind: interface_instruction_surface
  interface_refs:
    - FRIDA_INTERFACE_TASK_INTAKE
  repository_scope: target_app_repo_only
  mutation_scope: target_task_intake_only
  ownership_model: seed_then_user_owned
```

> Seeded baseline for task intake and triage in target application repositories.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_TASK_INTAKE`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_task_intake_only`.
- This instruction does **not** authorize mutation of the target app contract.

---

## Inputs

- Accept a raw request plus any existing task or inbox references needed for context.
- Read only `.frida/contract/app/**` as contract context.
- Use `tasks/inbox/**` for persisted non-executable intake outcomes.

## Normalization

- Restate the source request into a bounded implementation intent.
- Make missing acceptance criteria explicit before deciding publication.
- Treat `.frida/contract/app/**` as mandatory context; if it is missing or unusable, stop with `insufficient_contract_context`.

## Triage

- Allowed triage outcomes:
  `create_task_pack`, `route_to_architect_inbox`, `route_to_contract_editor`, `request_clarification`, `reject_as_invalid`
- Route to `route_to_architect_inbox` when the request needs architecture review.
- Route to `route_to_contract_editor` when the request implies app-contract mutation.
- Use `request_clarification` when acceptance criteria or scope cannot be made executable.

## Contract Read Requirements

- Read `.frida/contract/app/**` only.
- Do not use `.frida/inbox/app-contract/**` as task-setting ground truth.
- Treat `tasks/index.yaml` as the only normative task status surface.

## Collision Validation

- Intake does not publish a task pack before `contract_collision_scan` is delegated to `FRIDA_INTERFACE_TASK_VALIDATION`.
- If mirror integrity is missing, return `insufficient_contract_context`.

## Task Decomposition Rules

- Publish only one bounded implementation unit per future task pack.
- Keep one primary execution profile per task.
- If bounded decomposition is impossible, reroute instead of forcing publication.

## Publication Rules

- Only `create_task_pack` may proceed to `FRIDA_INTERFACE_TASK_SETTER`.
- Non-publication outcomes must persist an inbox item under `tasks/inbox/**`.
- Emit normalized output status only from:
  `task_created`, `task_rejected_contract_collision`, `task_rejected_insufficient_input`, `task_rerouted_to_architect_inbox`, `task_rerouted_to_contract_editor`, `task_waiting_for_clarification`

## Status Update Policy

- `tasks/index.yaml` is not authored by intake except when recording reroute bookkeeping required by local policy.
- `tasks/sessions/**` are not a status source of truth.

## Halting / Redirect Conditions

- Halt when `.frida/contract/app/**` is unavailable.
- Redirect when the request needs contract change, architecture review, or clarification.
- Reject as invalid when scope cannot be bounded into an executable unit.

## Output Schema

- Inbox item fields: `id`, `title`, `source_request`, `triage_outcome`, `reroute_target`, `reason`
- Required report fields: `frida_report`, `profile_id`, `verification`, `summary`
- Required verification: `frida-core check task-set`

Required invariants:

- `task_validation_mirror_only`
- `task_validation_requires_mirror_integrity`
- `task_triage_routes_before_publication`

Required rules refs:

- `FRIDA_INTERFACE_TASK_INTAKE`
- `FRIDA_INTERFACE_TASK_SETTER`
- `FRIDA_INTERFACE_TASK_VALIDATION`
- `FRIDA_INTERFACE_TASK_TRACKING`
