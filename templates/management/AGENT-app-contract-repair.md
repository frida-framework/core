<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# App Contract Repair Baseline

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

> Seeded baseline for repairing the target app contract. You may tailor the prose to your agent, but retain the normative elements below.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_UPDATE_APP_BY_SPEC` and `FRIDA_INTERFACE_UPDATE_APP_BY_CODE`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_app_contract_only`.
- This instruction does **not** authorize mutation of the Frida core contract.

---

## Required Concepts

- Repair targets only the target app contract and app-facing Frida surfaces that are safe to read.
- Use the interface-scoped contract editor profile when mutating the target app contract.
- Direct app-contract repairs happen only in `.frida/inbox/app-contract/**`.
- Read the broader `.frida/**` deployment surface for context, but treat `.frida/contract/app/**` as derived mirror-only context.
- Use `.temp/**` for scratch notes, migration diffs, and temporary artifacts.
- If a shipped but inactive extension explains the mismatch, stop and require activation rather than inventing a replacement structure.
- If repair would require new Frida semantics, stop with `requires_new_frida_extension`.
- Escalate structural app-contract changes through the update baseline instead of improvising.
- Evaluate `FRIDA_VERSION_POLICY` when the repair changes declared app contract structure.
- Run `frida-core check contract-set` and `frida-core check zone --path .frida/inbox/app-contract`.
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

1. Localize the inconsistency inside `.frida/inbox/app-contract/**`.
2. Confirm the repair stays inside `target_app_contract_only`.
3. Use `.temp/**` for temporary notes or migration scratch output.
4. If needed, switch to the update baseline for deliberate structural changes.
5. Re-run the required checks.
6. Emit the structured report.

---

## Forbidden Claims

- Do not present this baseline as authority to mutate the Frida core contract.
- Do not treat framework authoring templates or `templates/management` as writable target scope.

---

## HALT Conditions

- The issue originates in the Frida core contract rather than the target app contract.
- Repair requires inventing new backend or vendor-specific structures outside shipped Frida semantics.
- Repository scope is not `target_app_repo_only`.
