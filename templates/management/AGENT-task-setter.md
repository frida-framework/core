<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Task Setter Baseline

```yaml
instruction_surface:
  kind: interface_instruction_surface
  interface_refs:
    - FRIDA_INTERFACE_TASK_SETTER
  repository_scope: target_app_repo_only
  mutation_scope: target_task_spec_only
  ownership_model: seed_then_user_owned
```

> Seeded baseline for publishing immutable task packs in target application repositories.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_TASK_SETTER`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_task_spec_only`.
- This instruction does **not** authorize direct edits to `.frida/inbox/app-contract/**`.

## Inputs

- Read `.frida/contract/app/**` as the only contract context.
- Read intake results plus any validation artifact needed to confirm `valid`.
- Prepare publication only for `tasks/TASK-*.md`.

## Normalization

- Convert the approved request into one immutable task pack.
- Choose one primary `target_profile`.
- Embed concrete constraints instead of linking out to the contract.

## Triage

- Proceed only when intake outcome is `create_task_pack`.
- If validation is not `valid`, do not publish a task pack.

## Contract Read Requirements

- Read `.frida/contract/app/**` only.
- Do not use `.frida/inbox/app-contract/**`.
- Keep `tasks/index.yaml` separate from the task pack body.

## Collision Validation

- Run `contract_collision_scan` through `FRIDA_INTERFACE_TASK_VALIDATION`.
- Required commands:
  `frida-core check task-collision --task <path>`
  `frida-core check task-set`
- Publish only when `contract_validation_status` is `valid`.

## Task Decomposition Rules

- One task pack equals one bounded executable unit.
- Do not mix multiple primary execution profiles.
- Move contract edits and architecture choices out of this flow.

## Publication Rules

- Required frontmatter fields:
  `id`, `title`, `source_request`, `goal`, `scope`, `non_goals`, `target_paths`, `target_profile`, `interface_ref`, `constraints`, `dependencies`, `acceptance_criteria`, `verification`, `contract_validation_status`, `escalate_if`
- `interface_ref` must stay `FRIDA_INTERFACE_TASK_SETTER`.
- Forbidden live status fields:
  `status`, `current_status`, `progress`
- `tasks/TASK-*.md` is immutable after publication.

## Status Update Policy

- Store current status only in `tasks/index.yaml`.
- Reference the latest validation artifact from `.frida/reports/*.yaml`.
- Do not write execution telemetry into the task pack.

## Halting / Redirect Conditions

- Halt when validation is not `valid`.
- Redirect to intake if the request needs clarification or reroute.
- Halt when the task would require app-contract mutation.

## Output Schema

- Success output status: `task_created`
- Required report fields: `frida_report`, `profile_id`, `verification`, `summary`
- Required verification:
  `frida-core check task-collision --task <path>`
  `frida-core check task-set`

Required invariants:

- `task_pack_immutable`
- `task_pack_no_live_status`
- `task_validation_mirror_only`
- `task_validation_contract_collision_is_error`
- `task_validation_artifact_required`

Required rules refs:

- `FRIDA_INTERFACE_TASK_SETTER`
- `FRIDA_INTERFACE_TASK_VALIDATION`
- `FRIDA_INTERFACE_TASK_TRACKING`
