<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Frida Toolchain Upgrade Baseline

```yaml
instruction_surface:
  kind: interface_instruction_surface
  interface_ref: FRIDA_INTERFACE_TARGET_TOOLCHAIN_UPGRADE
  repository_scope: target_app_repo_only
  mutation_scope: target_app_toolchain_and_contract
  ownership_model: seed_then_user_owned
```

> Seeded baseline for the canonical Frida package + app-contract upgrade path. You may adapt wording and examples for your agent, but keep the normative elements below.

To restore the shipped baseline after local customization, run `frida-core bootstrap --component interface-instructions-reset --target <dir>`.

---

## Normative Link

- `interface_ref` / `interface_refs` MUST continue to name `FRIDA_INTERFACE_TARGET_TOOLCHAIN_UPGRADE`.
- repository scope stays `target_app_repo_only`.
- mutation scope stays `target_app_toolchain_and_contract`.
- This baseline implements `canonical_upgrade_path`.
- This baseline does **not** authorize mutation of the Frida core contract.

---

## Required Concepts

- Use `frida_toolchain_upgrade` as the profile for this scenario.
- Allowed source/edit surfaces are `package.json`, `package-lock.json`, `.frida/inbox/app-contract/**`, `scripts/**`, `docs/**`, and `.temp/**`.
- Read `.frida/**` for context, but keep `no manual edits under .frida/contract/**`.
- `no repo-local workaround profile` is part of the canonical upgrade path.
- Evaluate `FRIDA_VERSION_POLICY` after the change.
- Run `npm run frida:migration-report` before changing generated surfaces.
- Finish with `npm run frida:check:contract-set`.

Required invariants:

- `app_update_interfaces_non_inventive`
- `interface_instruction_surfaces_seed_then_user_owned`
- `target_delivery_no_internal_authoring_surfaces`

Required rules refs:

- `FRIDA_INTERFACE_TARGET_TOOLCHAIN_UPGRADE`
- `FRIDA_VERSION_POLICY`

Required report fields:

- `frida_report`
- `profile_id`
- `verification`
- `summary`

---

## Canonical Upgrade Path

1. Run `npm install`.
2. Run `npm run frida:migration-report`.
3. Run `npm run frida:bootstrap`.
4. Align `package.json`, `package-lock.json`, `.frida/inbox/app-contract/**`, `scripts/**`, `docs/**`, and `.temp/**` as needed.
5. Run `npm run frida:gen`.
6. Run `npm run frida:check:zone`.
7. Run `npm run frida:check:contract-set`.

The upgrade MUST either pass through this `canonical_upgrade_path` or halt with an actionable reason.

---

## Guardrails

- Treat `.frida/contract/**` as derived output only.
- If `frida_toolchain_upgrade` is missing in the target app contract baseline, align `.frida/inbox/app-contract/layers/AL02-agent-framework.yaml` first, rerun generation, and do not invent repo-local temporary profiles.
- If a requested app-contract change needs a brand-new extension or backend model, stop instead of inventing it.

---

## Forbidden Claims

- Do not present this baseline as authority to hand-edit generated `.frida/contract/**` output.
- Do not justify repo-local temporary profiles or router patches with this baseline.
- Do not present this baseline as authority to mutate the Frida core contract.
