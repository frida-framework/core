<!-- AUTO-GENERATED FROM CONTRACT - DO NOT EDIT MANUALLY -->

# Task Formulation for Development

> How to formulate a task for an agent-developer so the result does not contradict Canon.

---

## Principle

`CANON -> ANTITASK -> DEVELOPMENT`

A development task is a **translation** of Canon into a concrete action. The agent-developer must not independently interpret wiki canon.

Task Pack must be self-contained:

- Canon is not "attached by link" but transferred as concrete requirements.
- Executor needs only the Task Pack text + generated Antitask + Frida profile artifacts.

Source priority and conflict resolution determined by `contract:DOCS.sourcesModel`.

---

## Checklist Before Task Creation

Every item must be completed. If not — update Canon first (via AGENT-canon-update), then create task.

### Canon ready

- [ ] Feature described in the appropriate contract block (UI_STRUCTURE, UI_COMPONENT_CONTRACTS, UI_BEHAVIOR, RESOURCES, DATABASE_SCHEMA, BUILDTIME, etc.).
- [ ] All terms used in the task defined in GLOSSARY.

### Frida configuration ready

- [ ] Zone for target files exists in ZONES.
- [ ] Antitask generated after last canon update (run generation pipeline).
- [ ] Profile in TASK_PROFILES covers needed paths via edit_allowGlobRefs.
- [ ] Profile invariants current for the task.

### Task does not expand scope

- [ ] Task does not add functionality beyond what is described in canon.
- [ ] If new functionality needed — update canon first.

---

## Task Content

A development task must contain:

1. **What to do** — concrete action, no ambiguity.
2. **Files affected** — paths or zones.
3. **Profile to apply** — id from TASK_PROFILES.
4. **Canon requirements embedded** — guards/invariants/terms explicitly.
5. **Invariants to verify** — if task-specific.
6. **Verification command** — usually `npm run verify`, may differ by zone.

Unacceptable: "do it per canon, see wiki". Acceptable: "execute items X/Y/Z where X/Y/Z are explicitly listed."

---

## Tuning vs Optimization (route pipeline)

For tasks related to the route pipeline, two modes are distinguished:

**Tuning** (parameter adjustment): changing only preset values in `waypoint-config.ts`. Profile: `route_tuning`. Detector and generator logic is NOT touched. If a tuning task requires logic changes — HALT and request an optimization task.

**Optimization** (mechanics change): changing detector logic, generator, pipeline. Profile: `backend_core`. Must update `contract:WAYPOINT_SYSTEM_CANON` and `contract:ROUTE_PIPELINE_CANON` before task formulation.

---

## HALT Conditions

- Canon does not describe the feature being tasked.
- Zone or profile does not cover target files.
- Antitask not regenerated after last canon update.
- Task requires agent to write outside edit_allowGlobRefs.
