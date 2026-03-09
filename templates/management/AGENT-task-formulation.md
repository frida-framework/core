<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Task Formulation for Development

> How to formulate a task for an agent-developer so the result does not contradict the contract.

---

## Principle

`CONTRACT -> ANTITASK -> DEVELOPMENT` [FL13:5]

A development task is a **translation** of contract into a concrete action. The agent-developer must not independently reinterpret the contract.

Task Pack must be self-contained:

- Contract is not "attached by link" but transferred as concrete requirements.
- Executor needs only the Task Pack text + generated Antitask + Frida profile artifacts.

Source priority and conflict resolution determined by `contract:DOCS.sourcesModel`.

---

## Checklist Before Task Creation

Every item must be completed. If not — update contract first (via the appropriate management interface), then create task.

### Contract ready

- [ ] Feature described in the appropriate contract block (UI_STRUCTURE, UI_COMPONENT_CONTRACTS, UI_BEHAVIOR, RESOURCES, DATABASE_SCHEMA, BUILDTIME, etc.).
- [ ] All terms used in the task defined in GLOSSARY.

### Frida configuration ready

- [ ] Zone for target files exists in the repository-scoped zone block.
- [ ] Antitask generated after last contract update (run generation pipeline).
- [ ] Profile in the repository-scoped profile block covers needed paths via edit_allow/edit_allowGlobRefs.
- [ ] Profile invariants current for the task.
- [ ] `interface_ref` chosen for the task matches repository scope and mutation scope.

### Task output routing

- [ ] In repo `frida`, task output may only be `frida-tasks/TASK-*.md`.
- [ ] In repo `frida`, `tasks/` is forbidden and must not be read, created, or modified.
- [ ] Outside repo `frida`, `frida-tasks/` is forbidden.
- [ ] `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT` may output task files only inside repo `frida`.
- [ ] `FRIDA_INTERFACE_UPDATE_APP_BY_SPEC` and `FRIDA_INTERFACE_UPDATE_APP_BY_CODE` do not write task files in repo `frida`.

### Task does not expand scope

- [ ] Task does not add functionality beyond what is described in contract.
- [ ] If new functionality needed — update contract first.

---

## Task Content

A development task must contain:

1. **What to do** — concrete action, no ambiguity.
2. **Files affected** — paths or zones.
3. **Source interface** — `interface_ref` from management layer.
4. **Profile to apply** — id from the repository-scoped profile block.
5. **Contract requirements embedded** — guards/invariants/terms explicitly.
6. **Invariants to verify** — if task-specific.
7. **Verification command** — usually `npm run verify`, may differ by zone.

Unacceptable: "do it per contract, see docs". Acceptable: "execute items X/Y/Z where X/Y/Z are explicitly listed."

---

## Tuning vs Optimization (route pipeline)

For tasks related to the route pipeline, two modes are distinguished:

**Tuning** (parameter adjustment): changing only preset values in `waypoint-config.ts`. Profile: `route_tuning`. Detector and generator logic is NOT touched. If a tuning task requires logic changes — HALT and request an optimization task.

**Optimization** (mechanics change): changing detector logic, generator, pipeline. Profile: `backend_core` only when the relevant backend extension layer is active. If the capability exists only as an inactive shipped extension, HALT and require explicit extension activation before task formulation.

---

## HALT Conditions

- Contract does not describe the feature being tasked.
- Zone or profile does not cover target files.
- Antitask not regenerated after last contract update.
- Task requires agent to write outside edit_allowGlobRefs.
- `interface_ref` and task output path do not match repository scope.
