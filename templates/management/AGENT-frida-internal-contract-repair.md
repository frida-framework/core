<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Frida Internal Contract Repair Protocol

```yaml
instruction_surface:
  kind: interface_playbook
  interface_refs:
    - FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
  repository_scope: frida_repo_only
  mutation_scope: frida_contract_only
  ownership_model: engine_source_only
```

> Internal diagnostics and repair flow for the Frida core contract only.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT`

Repair of Frida governance surfaces starts from the contract and ends with regenerated engine invariants.

---

## Scope

- Allowed target: Frida contract and governance surfaces in repo `frida`
- Forbidden target: target app contract
- Forbidden target: target app repo code
- Escalation path for structural fixes: `AGENT-frida-internal-contract-update.md`

This playbook is derived from `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT`. It is not deployable to target application repositories.

---

## Diagnostics

1. Localize the defect to contract data, generated engine surfaces, or manifest drift.
2. If the fix requires contract mutation, switch to `AGENT-frida-internal-contract-update.md`.
3. Never repair by editing generated engine artifacts manually.
4. Regenerate strict engine surfaces after the fix.
5. Run `npm run build` and `node dist/cli.js check contract-set`.
6. Report the outcome with `frida_report`, `profile_id`, and `verification`.

---

## Required Normative Elements

- repository scope: `frida_repo_only`
- mutation scope: `frida_contract_only`
- authority ref: `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT`
- invariants: `engine_instruction_surfaces_strict`, `target_delivery_no_internal_authoring_surfaces`
- forbidden claim: no authority to mutate target app contract or target app repo code

---

## HALT Conditions

- Root cause cannot be isolated without touching target app surfaces.
- The repair would require editing generated engine artifacts manually.
- The defect is actually a target app contract issue rather than a Frida self-contract issue.
