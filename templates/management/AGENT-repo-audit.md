<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Repo Audit Protocol

> Repository-scoped audit protocol for Frida self-repo and deployed target application repos.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT` [FL13:5]

Audit executes against canonical contract entrypoints and must not rely on hidden engine-source surfaces.

---

## Goal

Determine whether the current repository is:

- `frida_repo`: the Frida core self-repo
- `target_app_repo`: a deployed application repo managed by Frida

Then validate contract structure, routing chain, deployed surface integrity, and CLI health for that repository scope.

---

## Repository Scope Resolution

Resolve repository scope before loading any audit canon:

1. If `contract/contract.index.yaml` exists and the repository is the Frida core checkout, scope is `frida_repo`.
   Canonical self-repo source path is `core-contract/contract.index.yaml`; `contract/contract.index.yaml` is the generated public projection.
2. Otherwise, if `.frida/inbox/app-contract/contract.index.yaml` exists, scope is `target_app_repo`.
3. If neither condition is satisfied, HALT with `CONTRACT.GAP`.

No audit step may depend on `.frida/templates/**`, `templates/frida/**`, `templates/docs-gen/**`, or other framework authoring surfaces inside a target repo.

---

## Canon Sources

### `frida_repo`

- Core contract entry: `core-contract/contract.index.yaml`
- Key layers: `core-contract/layers/FL03-infrastructure.yaml`, `core-contract/layers/FL05-agent-framework.yaml`, `core-contract/layers/FL09-bootstrap.yaml`, `core-contract/layers/FL11-management.yaml`, `core-contract/layers/FL13-agent-entry.yaml`
- Repository-scoped profile block: `FRIDA_TASK_PROFILES`
- Repository-scoped zone block: `INT_FRIDA_ZONES`
- Invariants and guards:
  - use `FRIDA_ENFORCEMENT.invariants`
  - use `FRIDA_ENFORCEMENT.policies` and normalize them into the audit guard view
  - if the assembled contract also exposes normalized `INVARIANTS` or `GUARDS`, they may be used as equivalent derived surfaces
- Audit interface: `FRIDA_INTERFACE_AUDIT`

### `target_app_repo`

- App contract entry: `.frida/inbox/app-contract/contract.index.yaml`
- Mirrored core contract entry: `.frida/contract/frida/contract.index.yaml`
- Repository-scoped profile block: `TASK_PROFILES`
- Repository-scoped zone block: `ZONES`
- Invariants block: `INVARIANTS`
- Guards block: `GUARDS`
- Audit interface: mirrored `FRIDA_INTERFACE_AUDIT`

### Contract loading rules

Load YAML contract artifacts directly from the canonical files above. Do not require markdown-fence extraction. Do not require `DOCS.sourcesModel`. Do not require `read_allowGlobRefs` or `edit_allowGlobRefs` specifically; audit the repository-scoped security surface as actually declared.

---

## Audit Checklist

### 1. Deployment surface

- Verify repository-scoped bootloader paths exist and point only to valid surfaces for the current scope.
- In `target_app_repo`, verify deployed playbooks exist under `.frida/contract/playbooks/*`.
- In `target_app_repo`, verify `.frida/templates/config.template.yaml` may exist, but `.frida/templates/frida/**` and `.frida/templates/docs-gen/**` do not exist and are not referenced.
- Verify `.frida` root layout matches the Frida root layout policy.

### 2. Contract integrity

- Verify the repository-scoped profile block exists.
- Verify the repository-scoped zone block exists.
- Verify invariant sources resolve for the current scope.
- Verify guard sources resolve for the current scope.
- Verify path refs used by audit and routing surfaces resolve.
- In `frida_repo`, treat `FRIDA_ENFORCEMENT -> INVARIANTS/GUARDS` normalization as canonical behavior.

### 3. Routing chain

- Verify root `AGENTS.md` exists and matches repository scope.
- Verify `ROUTER.xml` exists at `.frida/contract/specs/ROUTER.xml`.
- Verify profile XML files exist at `.frida/contract/profiles/`.
- Verify zone `AGENTS.md` files exist at the contractual `agentsPath` locations for the repository-scoped zone block.

### 4. Internal/public contour separation

- In `target_app_repo`, projected Frida surfaces must not reference:
  - `templates/management/*`
  - `templates/frida/*`
  - `templates/docs-gen/*`
  - `templates/template_app_basic/*`
  - `core-tasks/*`
  - `INT_FRIDA_ZONES`
  - `FRIDA_INT_AGENT_ROUTING`
  - `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT`
- In `frida_repo`, self-contract management and authoring paths may exist only in source surfaces, not as deployed target-repo requirements.

### 5. CLI diagnostics

Run:

- `frida-core migration-report`
- `frida-core check zone --path .`
- `frida-core check contract-set`

### 6. FRIDA Audit Run Report

Extension of standard Frida Run Report (`contract:FRIDA_RUN_REPORTING`) with fields: audit_score, compliance, undocumented_details.
Field `model` is optional: specify exact model name if known; if only family is known, specify family; do not guess; omit if unknown.

```yaml
version: "1.0"
frida_report: 1
status: "SUCCESS" # SUCCESS | FAIL | HALTED
model: "<exact_or_family_if_known>" # optional
profile_id: "<profile_id>"
inputs:
  prompt_summary: "Repo audit for <profile_id>"
  canon_snapshot:
    profile:
      id: "<profile_id>"
      role: "<role>"
      keywords: []
      security:
        read_allow: []
        edit_allow: []
        forbid: []
        edit_forbid: []
      invariants: []
    invariants_text: []
    guards: []
    extra_entities: []
changes:
  modified: []
  created: []
  deleted: []
verification:
  commands: []
  result: "SKIP"
summary:
  audit_score: 0
  what_checked: []
  compliance:
    fail: []
    partial: []
    unverifiable: []
  undocumented_details: []
  canon_gaps: []
  risks: []
  conclusions: ""
```

---

## Finding Tags

| Tag | Meaning |
|-----|---------|
| `COMPLIANCE.FAIL` | Canon requirement not met |
| `COMPLIANCE.PARTIAL` | Partially met |
| `UNVERIFIABLE` | Cannot be verified |
| `CONTRACT.GAP` | Definition missing in contract |
| `RISK.NDETERMINISM` | Non-determinism source |
| `RISK.SCOPE` | Potential boundary violation |

---

## Determinism

- Profiles sorted by id.
- Invariants sorted by id.
- Guards sorted by id.
- Zones sorted by id.
- Repository scope must be explicit.

---

## HALT Conditions

- Cannot determine repository scope.
- Repository-scoped profile block missing.
- Repository-scoped zone block missing.
- Canonical contract entrypoints are missing.
- CLI diagnostics cannot be executed and no equivalent local invocation path is available.
