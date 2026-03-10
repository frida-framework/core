<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Frida Internal Contract Update Protocol

```yaml
instruction_surface:
  kind: interface_playbook
  interface_refs:
    - FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
  repository_scope: frida_repo_only
  mutation_scope: frida_contract_only
  ownership_model: engine_source_only
```

> Internal self-contract update procedure for the Frida core repository only.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT`

Internal contract work starts with Frida contract data, then regenerates dependent engine surfaces, then emits downstream tasking if needed.

---

## Scope

- Allowed target: Frida contract blocks and related engine-owned governance files inside repo `frida`
- Forbidden target: target app contract
- Forbidden target: target app repo code
- Required authority: `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT`

This playbook is derived from `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT`. It is not deployable to target application repositories.

---

## Workflow

1. Determine the affected Frida contract blocks and supporting governance files.
2. Prepare an atomic patch for contract-only mutations.
3. Reconcile refs, guards, invariants, zones, routing, and manifest hashes when affected.
4. Regenerate strict engine instruction surfaces.
5. Run `npm run build` and `node dist/cli.js check contract-set`.
6. Report the contract mutation with `frida_report`, `profile_id`, and `verification`.

---

## Required Normative Elements

- repository scope: `frida_repo_only`
- mutation scope: `frida_contract_only`
- authority refs: `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT`, `FRIDA_VERSION_POLICY`, `FRIDA_TEMPLATE_HASH_TOOL`
- invariants: `engine_instruction_surfaces_strict`, `target_delivery_no_internal_authoring_surfaces`
- change order: `CONTRACT -> ANTITASK -> DEVELOPMENT`

---

## HALT Conditions

- The requested change requires mutating target app contract or target app repo code.
- The affected Frida contract block cannot be determined unambiguously.
- Manifest hashes drift and cannot be localized to the current patch.
- Verification does not pass after regeneration.
