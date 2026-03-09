<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Contract Update Protocol

> Algorithm for updating contract blocks when changes are requested.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT`

Order is fixed: contract changes first, then antitask is regenerated, then development tasks are created.

---

## Efficiency Paradigm

Contract is an instrument, not an archive. If the usefulness of an entry is doubtful, propose removal. Brevity and precision are more valuable than completeness. Non-functioning or unnecessary descriptions are noise that slows down agents and humans.

---

## Contract Fixer Role

- **Exclusive:** Contract Fixer is the only role that may modify contract blocks.
- **Patch Proposals:** Agents without the Contract Fixer role may only prepare patch proposals without actually applying them.
- **Constraint:** Applied only via PR and manual workflow run.
- **Input:** Human request + current contract state.
- **Procedure:**
  1. Read contract layers in dependency order.
  2. Modify only contract blocks.
  3. Run sync + gen + verify chain.
  4. Produce structured summary: which blocks changed and why.
  5. Open PR and wait for approval as mandatory gate.

---

## Strict Workflow

### 1. Determine affected blocks

Build explicit `affected_blocks[]` with source file for each block.
If any required block cannot be determined unambiguously — HALT.

### 2. Prepare diff per block

For each `affected_blocks[i]`:

- `before`: original fragment
- `after`: new fragment
- `reason`: link to request

### 3. Run consistency checklist

Check every item in the Consistency Checklist section below. Unchecked items are not allowed.

### 3.1. Sync hash manifests for static package assets

If the patch changes any manifest-declared static asset, run `frida-core hash` before final verification.

- `frida-core hash` is check-only.
- It does not rewrite `contract/template-integrity.manifest.yaml`.
- It does not rewrite `contract/bootstrap-package.manifest.yaml`.
- On mismatch, update the affected manifest `sha256` entries manually in the same patch, then rerun the tool.

### 4. Update guards/invariants if needed

If behavior change violates or extends current rules:

- Update guards and/or invariants.
- Update all references (profiles, validation rules, zones).

If update is needed but not performed — HALT.

### 5. Assemble final patch (proposal only)

One atomic changeset:

- Only target contract blocks.
- No prose edits unless required for navigation.
- All refs and ids valid.

### 6. PR gate

After human confirmation, open PR. Until PR approval, status is incomplete.

---

## Change Protocol Operations

Operations from `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.change_protocol`:

1. `ADD <BLOCK>.<path> = <value>`
2. `UPDATE <BLOCK>.<path> FROM <old> TO <new>`
3. `MOVE <BLOCK>.<from> -> <BLOCK>.<to>` + mandatory `replacedByRef`
4. `DEPRECATE <BLOCK|path>` + required: status, replacedByRef, date_deprecated, compat_note
5. `REFCHECK` — all *Ref/*Refs resolve
6. `GUARDCHECK` — guardRefs satisfiable
7. `PROFILECHECK` — no allow/forbid conflicts
8. `FENCECHECK` — opening/closing fences match
9. `DUPCHECK` — block names unique across contract tier
10. `RESERVED_CHECK` — block name not in FRIDA_CORE_RESERVED list; no copying from core contract layers
11. `CONTRACT-DIFF` — patch contains only target fragments

Note: `FRIDA_CORE_RESERVED` block is marked `_nail: true` / `_immutable: true` — it cannot be replaced, modified, or deleted.

---

## Consistency Checklist

### Terms

- Every term in input/output/rules has a GLOSSARY entry.
- Allowed terms used correctly; forbidden terms absent.
- One term = one name; no synonyms.
- Naming: PascalCase for types, camelCase for collections, snake_case for DB fields/triggers.

### Guards and invariants

- Each new guard has unique id.
- Each new invariant has unique id and correct profile bindings.
- Renamed ids updated across all pages.

### Profiles

- `forbidGlobRefs` does not intersect `read_allowGlobRefs`/`edit_allowGlobRefs`.
- `edit_forbidGlobRefs` does not intersect `edit_allowGlobRefs`.
- Redirect rules use typed refs (`security.redirects[].fromGlobRef/(toFileRef|toDirRef)/reason`).
- Guard constraints satisfiable within profile security scope.

### Zones

- New/changed zones create no implicit conflicts (most specific wins).
- Each zone has `pathGlobRef`, `agentsPathDirRef`, `agentsTemplate`.
- `guardRefs` resolve to existing guards.

### Cross-references

- All `guardRef` resolve in GUARDS.
- All profile `invariants` resolve in INVARIANTS.
- All `*Ref` and `PATHS.*` resolve to existing entities.

### Component boundaries

- Component-level contract files include all canonical sections from `component_contract_spec.required_sections`.
- Visual projection rules live in `FRIDA_VISUAL.component_projection`; management blocks may reference them but must not redefine them.
- `component_mount_point.mounted_child_boundaryRefs` resolve when declared.
- `component_output_interface` exit entries define required outcome semantics.
- `component_output_interface.target_boundaryRef` and `return_target_boundaryRef` resolve when declared.
- Parent specification view does not inline mounted child internals; drill-in remains explicit.
- `component_shared_refs` remain dependency-only and do not carry ownership or boundary semantics.
- Legacy section names are absent from active definitions unless explicitly historical/deprecated.
- Mixed legacy/new component-boundary namespace usage is forbidden.

### YAML Fence structure

- Each block has matching opening/closing fence.
- Minimum one markdown element between adjacent blocks.
- No triple backticks inside YAML blocks (use `content: |` for template content).
- When editing end of block, closing fence must be visible in context.
- Two contract blocks must not be merged into one fence.

### Block uniqueness (DUPCHECK)

- Each block name unique across contract tier.
- Duplicate `contract:<BLOCK_NAME>` → HALT.

### Reserved names (RESERVED_CHECK)

- Block name not in `FRIDA_CORE_RESERVED` list.
- Copying from core contract layers into app contract is forbidden.

### UI boundaries

- `UI_STRUCTURE.layout` = structural only (pages, sections, slots).
- Conditional logic, auth branches, interactions → `UI_BEHAVIOR`.
- Fields like `condition_*`, `requires_auth`, runtime branches in layout → extract to `UI_BEHAVIOR.*`.

---

## Quality Metrics

Metrics from `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.quality_metrics`:

### Blocking (must = 0)

| Metric | Definition |
|--------|-----------|
| `NON_ABS` | *Ref/*Refs values not in absolute form (`BLOCK_NAME.path` or `contract:BLOCK_NAME.path`) |
| `ISSUES` | Sum of all issue components below |
| `WIKI_LINK_ISSUES` | Broken wiki-links/anchors in agent protocol documents (operational alias: `BROKEN_NAV_LINKS`) |
| `AGENT_DRIFT_ISSUES` | Structural discrepancies in agent protocol documents relative to required structure |

### Issue components

| Component | What counts as error |
|-----------|---------------------|
| `PARSE_ERRORS` | Invalid YAML in any contract block |
| `FENCE_ERRORS` | Missing/extra fence; two blocks in one fence; triple backtick inside YAML block breaking fence |
| `DUP_BLOCKS` | Duplicate block name |
| `UNRESOLVED_REFS` | Unresolvable *Ref (guardRef, invariantRef, resourceRef, schemaRef, slotRef, buildRef, componentRef, PATHS.*) |
| `PROFILE_CONFLICTS` | allow/forbid intersections |
| `ZONE_SCHEMA_ERRORS` | Missing required zone fields (pathGlobRef/agentsPathDirRef/agentsTemplate) or guardRefs not resolving |
| `BROKEN_NAV_LINKS` | Broken links/anchors in agent protocol documents |
| `AGENT_DRIFT_ISSUES` | Structural protocol violations (see computation rules below) |

### How to compute `AGENT_DRIFT_ISSUES`

Minimum required checks:

1. Routing table points only to existing playbook documents.
2. Each playbook contains the principle `CONTRACT -> ANTITASK -> DEVELOPMENT`.
3. Each playbook has an explicit `## HALT Conditions` section.
4. Absence of any item above increments `AGENT_DRIFT_ISSUES`.

### Diagnostic metrics (non-blocking)

| Metric | Purpose |
|--------|---------|
| `DEPRECATED_WITHOUT_REPLACEDBY` | Deprecated nodes without `replacedByRef` |
| `DANGLING_REPLACEDBY` | `replacedByRef` points to non-existent entity |
| `TERM_GAPS` | Terms from rules/contracts absent in GLOSSARY |
| `REDUNDANT_DESCRIPTIVE` | Critical rule duplicated only in prose, not anchored in contract block |
| `REF_STYLE_MIX` | Mixed short-id and absolute refs in same subsystem |
| `UNUSED_GUARDS` | Guard id defined but not used in globalGuardRefs, repo-scoped zone guardRefs, VALIDATION_RULES, or profile guardRefs |
| `UNUSED_INVARIANTS` | Invariant defined but not used in TASK_PROFILES.invariants or contractual invariantRef |

### Quality Gate

All blocking metrics must equal 0 before patch finalization. If any value ≠ 0 — HALT, fix causes first.

---

## Two-Way Actualization

When adding, renaming, or removing contract blocks, the same change must update the playbook documents and routing references if affected.

---

## Deletion Rules

1. Move consumers to replacement (replacedByRef or MOVE/UPDATE).
2. Confirm UNRESOLVED_REFS = 0.
3. Remove superseded id/block in same patch.

If safe removal impossible — deprecation scaffold: status, replacedByRef, date_deprecated, compat_note.

---

## Temporary File Naming (recommendation, non-blocking)

To prevent accidentally leaving temporary files perceived as normative:

Recommended pattern: `<unixtime>-TMP-GEN-<topic>-<source>-TO-DELETE.md`

- `unixtime` prefix gives stable sort order and near-zero name collision probability.
- First lines should include: `status: TEMPORARY`, `generated: true`, `delete_after: <date>`.
- Store in a dedicated temp zone/directory and delete after use.

---

## HALT Conditions

- Request does not map to any contract block.
- Cannot determine `affected_blocks` unambiguously.
- `no_profile_match`: profile not determinable from the repository-scoped profile block.
- Change requires guard/invariant update but human did not confirm.
- Key term missing from GLOSSARY and request does not include adding it.
- Patch requires application but no human confirmation or PR approval.
