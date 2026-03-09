<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Contract Diagnostics & Repair

> Reactive diagnostics: symptom -> cause -> algorithm.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT`

Repair always starts with contract, then Antitask is regenerated, then development proceeds.

Interpretation principle: **no heuristics**. For contract tier, only explicit contract data is used.

If repair requires contract block edits, invoke Contract Fixer via AGENT-contract-update.
Other agents prepare only patch proposals without direct editing.

---

## Diagnostic Table

| Symptom | Cause | Algorithm |
|---------|-------|-----------|
| Missing AGENTS.md in zone | Zone not configured or generation not run | [Missing artifacts](#missing-artifacts) |
| zone_count mismatch | Metadata desynchronization | [Metadata mismatch](#metadata-mismatch) |
| Contract drift detected | Manual edits in generated files | [Contract drift](#contract-drift) |
| Agent edits wrong files | Profile routing or zone resolution error | [Routing error](#routing-error) |
| Guard violation | Code violates guard statement | [Guard violation](#guard-violation) |
| Generator failure | Invalid YAML or schema violation | [Generator failure](#generator-failure) |

---

## Missing artifacts

1. Check if path exists in the repository-scoped zone block.
2. If yes — run generation pipeline.
3. If no — add zone to contract, then run generation.

---

## Metadata mismatch

1. Check metadata counts in root bootloader.
2. Count actual generated files in zones.
3. Run generation pipeline.
4. If mismatch persists — check the repository-scoped zone block for missing pathGlobRef/agentsPathDirRef.

---

## Contract drift

1. Run generation pipeline.
2. Diff generated surface against working tree: `git diff --name-only`.
3. Generated surface includes:
   - `contract/**`
   - `docs/policy/**`
   - `docs/reference/**`
   - `.specs/**`
   - `.frida/**`
   - `AGENTS.md` (root)
   - `{zone.agentsPath}/AGENTS.md` (resolved from zone.agentsPathDirRef) for zones from the repository-scoped zone block
4. If drift in generated files — restore only those paths (no mass rollback):
   - Base safe restore:
     `git restore --worktree --staged -- contract/ docs/policy/ .specs/ .frida/ AGENTS.md`
   - Reference docs:
     `git restore --worktree --staged -- docs/reference/`
   - Zonal AGENTS.md (bash):
     `git diff --name-only | rg 'AGENTS\.md$' | while IFS= read -r f; do git restore --worktree --staged -- "$f"; done`
   - Single file:
     `git restore --worktree --staged -- <file>`
   - Re-check: `git diff --name-only`.
5. If generated-path restore does not localize the problem:
   - Save diff to a separate file for analysis.
   - Do NOT use mass rollback commands.
   - Pass file list and diff to human for manual resolution.
6. Never edit generated files manually.
7. If drift is intentional: update contract first, then regenerate (`npm run frida:gen`; `npm run docs:generate` is alias).

Source of truth and priorities determined by `contract:DOCS.sourcesModel`.

---

## Routing error

### Profile routing

1. Determine profile_id from the repository-scoped profile block via router rules.
2. Verify profile covers task via security allowlists.
3. If profile not determinable — `no_profile_match = HALT`.

### Zone resolution

1. For each target path, find matching zones from the repository-scoped zone block.
2. Normalize paths per ZONE_RESOLUTION.normalization.
3. Apply selection order: longest literal prefix → fewer wildcards → lexicographic.
4. Verify actions within allowed zone with its guardRefs.

---

## Guard violation

1. Read verification output message.
2. Find guard id in GUARDS.
3. Fix code to comply with guard statement.
4. If violation caused by changed requirements — update contract first via AGENT-contract-update, then re-verify.

Common guards (full list in GUARDS):

| ID | Essence |
|----|---------|
| `contract.source.wiki` | Source of truth defined by `contract:DOCS.sourcesModel` |
| `ui.no-direct-supabase` | UI must not import Supabase directly |
| `deploy.edge.no-direct-cli` | Deployment only via CI |
| `workspace.snapshot-immutable` | Workspace data is a snapshot, not live-updated |
| `workspace.share-readonly` | Workspace by share_token is read-only |

---

## Generator failure

1. Read error message from generation pipeline.
2. If YAML parse error — fix syntax in indicated contract block (indentation, quotes, unclosed fence).
3. If validation error — read rule description and bring contract data into compliance.
4. Re-run generation.
5. If error cannot be localized — HALT and pass error message to human.

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm run frida:gen` | Regenerate agent context |
| `npm run verify` | Check guards |
| `npm run docs:generate` | Alias for `frida:gen` (regenerate policy/reference docs and related generated artifacts) |

---

## HALT Conditions

- Cannot determine root cause between contract, antitask, and generated surface.
- `no_profile_match`: profile not determinable from the repository-scoped profile block.
- Contract block changes required but human has not confirmed.
- No PR or no PR approval for contract changes.
- Unresolvable conflict between source model and actual artifacts.
- Recovery requires ambiguous or mass destructive rollback.
