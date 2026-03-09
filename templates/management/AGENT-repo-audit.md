<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Repo Audit Task Builder

> Generate self-contained Audit Task Packs for verifying contract implementation in repository.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT` [FL13:5]

Audit Task Packs are formed from contract and executed within Antitask constraints without additional interpretation.

---

## Goal

Build one audit task per profile_id from the repository-scoped profile block.

Each task is self-contained:

- Contains applicable requirements and definitions.
- Does not send the executor to wiki for re-interpretation.

Output per task: AUDIT SCORE (0-100), list of discrepancies, list of Undocumented details.

---

## Sources

Use only the priority model from `contract:DOCS.sourcesModel`.

For contract-tier, extract data as follows:

1. In deployed repos, use `.frida/inbox/app-contract/contract.index.yaml` as the authoritative app-contract entry point and `.frida/contract/frida/contract.index.yaml` for the mirrored Frida core contract.
2. If an older repo exposes only `contract/contract.cbmd.yaml`, treat it as compatibility-only snapshot.
3. If snapshot is absent or incomplete, extract contract blocks from zerohuman-* pages.
4. If snapshot conflicts with wiki blocks, mark `CANON.GAP` and treat wiki contract blocks as normative.

---

## Block Extraction

Scan markdown and extract blocks by marker `` ```yaml contract:<BLOCK_NAME> ``.

Build index `blocks[BLOCK_NAME] -> parsed_yaml`.

If `BLOCK_NAME` is duplicated — mark `CONTRACT.GAP` and HALT: duplicate block name makes contract ambiguous; deterministic contract artifact generation must return `FAIL`.

### Profile list

Source: repository-scoped profile block. If block is absent — HALT.

---

## What to include in a profile task

### A. Profile definition

Full TASK_PROFILES[profile_id] record.

### B. Profile invariants

For each invariant_id from profile.invariants — embed text from INVARIANTS.
Missing invariant → CANON.GAP.

### C. Applicable guards (deterministic)

Formula: `applicable = GUARDS.globalGuardRefs + union(touched_zones.guardRefs)`

Where `touched_zones` derived from profile allowlists via ZONE_RESOLUTION.

Important: `touched_zones` derivation for repo-audit is NOT execution zone resolution.
Execution zone resolution is defined only by the repository-scoped zone block for a specific target path (most specific wins).

Algorithm:

1. `allowlist = read_allowGlobRefs ∪ edit_allowGlobRefs`.
2. For each path/pattern from `allowlist`, find intersecting zone path definitions from the repository-scoped zone block (after resolving `PATHS.*`).
3. Select one zone per path by `ZONE_RESOLUTION.selection.order`:
   - longest normalized literal prefix before wildcard,
   - if equal — fewer wildcard tokens,
   - if equal — lexicographic by zone name.
4. `touched_zones = union(selected zones)`.
5. Compute `applicable` using the single formula above.
6. Remove duplicates preserving first-occurrence order.
7. Each `guardRef` must exist in `GUARDS.guards[*].id`; otherwise `CANON.GAP`.

No heuristics by statement text, keywords, or natural language.

### D. Related contract blocks

Embed only verifiable fragments needed for audit. Follow explicit *Ref links only.

Applicable blocks:

- `TASK_PROFILES` (current profile)
- `INVARIANTS` (profile id)
- `GUARDS` (ids from `applicable`)
- repository-scoped zone block (only `touched_zones`)
- `DOCS` (source rules for conflict resolution)
- `BUILDTIME` (if profile touches mapper or polygon build zones)
- `UI_STRUCTURE`, `UI_COMPONENT_CONTRACTS`, `UI_BEHAVIOR` (if profile touches UI/pages)
- Additional blocks only by explicit refs (*Ref, id fields), not by token heuristics.

### E. Terms

If requirements use GLOSSARY terms, embed definitions. Missing term → CANON.GAP.

---

## Task Format

Each `TASK-REPO-AUDIT-<profile_id>.md` contains:

### 1. Scope

- profile_id, audit target
- Readable paths (from read_allowGlobRefs)
- Forbidden paths (from forbidGlobRefs + edit_forbidGlobRefs)

### 2. Embedded Canon Snapshot

- Full profile record
- Invariant texts
- Applicable guards
- Related block fragments
- Term definitions

### 3. Audit Checklist

Each item: what to verify + what evidence to attach.

Coverage:

- Profile surface (allow/forbid paths exist, no conflicts; `security.redirects[].fromGlobRef/(toFileRef|toDirRef)/reason` consistent; all `PATHS.*` refs resolve)
- Each invariant
- Each guard
- Each embedded entity
- Component-boundary contracts, when present: canonical component_* sections complete, mounted child refs resolve, exit outcomes explicit, parent view does not inline child internals, and shared refs stay dependency-only

### 4. Undocumented details

Executor must collect:

- Runtime config / env variables and their validation
- Hidden data contracts (DTO/types between layers not described in contract)
- Implicit rules (sorts, filters, magic numbers, defaults)
- External dependencies (services, SDK, versions)
- Non-determinism sources (time, random, concurrency)

### 5. Scoring (0-100)

| Block | Weight | What is evaluated |
|-------|--------|-------------------|
| Surface | 25 | Paths exist, forbids not violated, redirects consistent, all PATHS.* refs resolve |
| Invariants | 30 | Each invariant verified with evidence |
| Guards | 25 | Each guard verified with evidence |
| Undocumented | 10 | Real details collected with code references |
| Reproducibility | 10 | Verification commands listed, limitations stated |

Threshold: **≥ 70 = PASS**, **< 70 = FAIL**.
Any `COMPLIANCE.FAIL` → status FAIL regardless of score.
If verification impossible — score reduced, item marked `UNVERIFIABLE`.

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
        read_allowGlobRefs: []
        edit_allowGlobRefs: []
        forbidGlobRefs: []
        edit_forbidGlobRefs: []
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

- Profiles sorted by name.
- Invariants within task sorted by id.
- Guards within task sorted by id.
- Zones within task sorted by zone name.
- No "at discretion" alternatives.

---

## Output Artifacts

Generator creates `TASK-REPO-AUDIT-<profile_id>.md` files and delivers them to human for placement in repository.

For large numbers of tasks — additionally `TASK-REPO-AUDIT-INDEX.md` with coverage map.

---

## HALT Conditions

- Cannot get profile list (no TASK_PROFILES).
- YAML parsing too broken to extract profile keys.
- Duplicate block name detected (contract ambiguity; contract artifact generation must return `FAIL`).
