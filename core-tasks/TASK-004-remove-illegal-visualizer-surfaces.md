---
id: 004-remove-illegal-visualizer-surfaces
status: OPEN
profile_id: frida_governance
interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
title: Remove illegal visualizer execution surfaces from the Frida repo
summary: Remove demo, template, and fixture-based visualizer execution surfaces from C:\Projectx1\frida and keep the visualizer only as a shipped source surface.
acceptance_criteria:
  - package.json no longer exposes template-app or demo visualizer commands in the Frida repo.
  - README no longer instructs running the visualizer inside the Frida repo or against template/demo inputs.
  - Visualizer fixture overlays and fixture-based runtime checks are removed from the Frida repo.
  - Frida-repo verification retains only static legality and contract checks for the visualizer surface.
verification_cmd: npm run build && node dist/cli.js check contract-set
---

# TASK-004: Remove Illegal Visualizer Execution Surfaces From The Frida Repo

## Objective

Align the Frida repository with the new visualizer legality model:

- `C:\Projectx1\frida` may ship visualizer source and contract semantics.
- `C:\Projectx1\frida` must not generate, run, demo, or smoke-test the visualizer locally.
- Demo, template, and fixture execution paths are illegal and must be removed.

This task assumes Block 1 has already landed and the contract now forbids:

- visualizer fixtures
- demo overlays
- Frida-repo-local visualizer execution
- treating `template_app_basic` as a legal application contract

## Required Changes

### 1. Remove illegal npm command surfaces

From [package.json](C:/Projectx1/frida/package.json), remove command surfaces that execute the visualizer inside the Frida repo, including:

- `frida:visual-viewer:template-app`
- `frida:visual-viewer:demo`

If any equivalent renamed command exists after Block 1, remove the Frida-repo-local execution form as well.

### 2. Remove README execution guidance

From [README.md](C:/Projectx1/frida/README.md):

- remove instructions that tell users to generate or run a visualizer inside the Frida repo
- remove references to template-app or demo visualizer outputs
- keep documentation limited to shipped source semantics and target-repo usage only

### 3. Remove fixture and demo inputs

Delete visualizer fixture/demo input surfaces used only to make the Frida repo itself runnable, including:

- `templates/tooling/verify/fixtures/visual-overlay/**`
- any `demo_overlay`-driven verification or example wiring

If a remaining file mentions visualizer fixtures as valid inputs, update or remove it so the repo no longer teaches that pattern.

### 4. Remove runtime smoke checks from Frida repo

Delete or rewrite runtime checks that currently execute the visualizer from inside the Frida repo, including checks equivalent to:

- generating HTML from a mounted-child demo overlay
- generating HTML from `templates/template_app_basic/app-contract/contract.index.yaml`
- asserting presence of viewer output files produced inside `dist/reference-viewer/**`

Replace them with static checks only:

- no fixture references remain
- no demo overlay references remain
- no template-app visualizer execution path remains
- no Frida-repo-local visualizer execution path remains

### 5. Keep visualizer as source only

After cleanup, the Frida repo may still contain:

- visualizer source files
- visualizer contract/schema definitions
- target-repo dispatch/build logic

But it must no longer function as a legal local execution environment for the visualizer.

## Non-Goals

- Do not remove the visualizer feature from the package entirely.
- Do not move target-repo runtime checks into this task; that belongs to follow-up tasks.
- Do not reintroduce fixture-only exceptions.

## Verification

Run:

```bash
npm run build && node dist/cli.js check contract-set
```

Additionally confirm by inspection that:

- no visualizer demo/template commands remain in `package.json`
- no visualizer fixture overlays remain under `templates/tooling/verify/fixtures/visual-overlay/`
- no README section teaches local visualizer execution in the Frida repo
