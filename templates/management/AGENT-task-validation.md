<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Task Validation Baseline

```yaml
instruction_surface:
  kind: interface_instruction_surface
  interface_refs:
    - FRIDA_INTERFACE_TASK_VALIDATION
  repository_scope: target_app_repo_only
  mutation_scope: target_task_validation_only
  ownership_model: seed_then_user_owned
```

> Seeded baseline for validating task packs against the app contract mirror.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_TASK_VALIDATION`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_task_validation_only`.
- This instruction does **not** authorize reading `.frida/inbox/app-contract/**` as task-setting ground truth.

## Inputs

- Read the candidate task pack.
- Read `.frida/contract/app/**` only.
- Emit a machine-readable validation artifact into `.frida/reports/*.yaml`.

## Normalization

- Resolve the task id, `target_profile`, and `target_paths` before collision analysis.
- Normalize the contract source set to `.frida/contract/app/**` only.

## Triage

- Validation decisions:
  `valid`, `invalid_contract_collision`, `requires_contract_change`, `requires_architectural_review`, `insufficient_contract_context`
- Output statuses:
  `task_created`, `task_rejected_contract_collision`, `task_rejected_insufficient_input`, `task_rerouted_to_architect_inbox`, `task_rerouted_to_contract_editor`

## Contract Read Requirements

- `.frida/contract/app/**` is the only legal validation source.
- If `.frida/contract/app/**` is missing, invalid, or stale, return `insufficient_contract_context`.
- Do not read `.frida/inbox/app-contract/**` for this interface.

## Collision Validation

- Run `contract_collision_scan` with `frida-core check task-collision --task <path>`.
- Also run `frida-core check task-set`.
- Treat contract collision as an error, not a warning.
- `invalid_contract_collision` rejects publication.
- `requires_contract_change` reroutes to contract editor.
- `requires_architectural_review` reroutes to architect inbox.

## Task Decomposition Rules

- Reject or reroute tasks that cannot stay bounded to one primary execution profile.
- Reject tasks that smuggle contract edits into implementation scope.

## Publication Rules

- Validation never edits `tasks/TASK-*.md`.
- Validation publishes or refreshes the validation artifact only.
- Published task packs must carry `contract_validation_status: valid`.

## Status Update Policy

- Validation may advance registry status to `validated` or `ready`.
- Validation does not use `tasks/sessions/**` as a status source.

## Halting / Redirect Conditions

- Halt on `insufficient_contract_context`.
- Redirect on `requires_contract_change` or `requires_architectural_review`.
- Reject on `invalid_contract_collision`.

## Output Schema

- Validation artifact fields:
  `task_id`, `validation_time`, `contract_sources`, `collision_scan_result`, `conflicts`, `decision`, `reroute_target`, `notes`
- Required report fields: `frida_report`, `profile_id`, `verification`, `summary`
- Required verification:
  `frida-core check task-collision --task <path>`
  `frida-core check task-set`

Required invariants:

- `task_validation_mirror_only`
- `task_validation_requires_mirror_integrity`
- `task_validation_artifact_required`
- `task_validation_contract_collision_is_error`

Required rules refs:

- `FRIDA_INTERFACE_TASK_VALIDATION`
- `FRIDA_INTERFACE_TASK_SETTER`
- `FRIDA_INTERFACE_TASK_TRACKING`
