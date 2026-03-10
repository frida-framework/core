<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# App Contract Update Baseline

```yaml
instruction_surface:
  kind: interface_instruction_surface
  interface_refs:
    - FRIDA_INTERFACE_UPDATE_APP_BY_SPEC
    - FRIDA_INTERFACE_UPDATE_APP_BY_CODE
  repository_scope: target_app_repo_only
  mutation_scope: target_app_contract_only
  ownership_model: seed_then_user_owned
```

> Seeded baseline for updating the target app contract. You may adapt wording, order, and examples for your agent, but keep the normative elements below.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_UPDATE_APP_BY_SPEC` and `FRIDA_INTERFACE_UPDATE_APP_BY_CODE`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_app_contract_only`.
- This instruction does **not** authorize mutation of the Frida core contract.

---

## Required Concepts

- Use only target app contract surfaces.
- Stay inside shipped Frida baseline semantics and already-designed app extensions.
- If a shipped but inactive extension fits the request, stop and request explicit activation instead of inventing a parallel structure.
- If no shipped extension fits, stop with `requires_new_frida_extension`.
- Evaluate `FRIDA_VERSION_POLICY` after the change.
- Run `frida-core check contract-set` and `frida-core check zone --path .`.
- Emit a report that includes `frida_report`, `profile_id`, `verification`, and `summary`.

Required invariants:

- `app_update_interfaces_non_inventive`
- `interface_instruction_surfaces_seed_then_user_owned`
- `target_delivery_no_internal_authoring_surfaces`

Required rules refs:

- `FRIDA_INTERFACE_UPDATE_APP_BY_SPEC`
- `FRIDA_INTERFACE_UPDATE_APP_BY_CODE`
- `FRIDA_VERSION_POLICY`

---

## Minimal Procedure Baseline

1. Read the current target app contract and the relevant app-facing Frida mirror.
2. Identify whether the request is spec-driven or code-driven, but keep the same contract mutation boundary.
3. Prepare the app-contract patch only.
4. Verify refs, zones, and interface consistency.
5. Run the required checks.
6. Emit the structured report.

---

## Forbidden Claims

- Do not present this baseline as authority to mutate the Frida core contract.
- Do not treat framework authoring templates or `templates/management` as writable target scope.

---

## HALT Conditions

- Requested change requires Frida core contract mutation.
- Requested change requires inventing new backend or vendor-specific structures outside shipped Frida semantics.
- Repository scope is not `target_app_repo_only`.
