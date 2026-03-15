---
id: 006-target-repo-visualizer-build-and-runtime
status: OPEN
profile_id: frida_governance
interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
title: Build and run the visualizer only in target repos as a diagram-first surface
summary: Deliver the visualizer as a target-repo-only on-demand build that renders an interactive SVG architecture diagram and keeps boundary-first navigation.
acceptance_criteria:
  - The Frida package ships visualizer source/templates without relying on a runnable local Frida-repo build surface.
  - A legal target repo can build the visualizer on demand and emit dist/visualizer/index.html.
  - The primary runtime surface is an interactive SVG architecture diagram, not list-first cards or panels.
  - Navigation remains boundary-first across topology, flow, and specification modes.
verification_cmd: npm run build && node dist/cli.js check contract-set
---

# TASK-006: Build And Run The Visualizer Only In Target Repos As A Diagram-First Surface

## Objective

Move the visualizer delivery model to the target app repo only:

- Frida package ships source/templates and command logic
- target repo performs the actual on-demand build
- resulting artifact is `dist/visualizer/index.html`
- primary UI is an interactive architecture diagram

This task assumes:

- Block 1 already makes the visualizer diagram-first and target-repo-only
- TASK-004 has removed illegal local execution surfaces from the Frida repo
- TASK-005 has introduced the legality-gated dispatch command

## Required Changes

### 1. Ship source, not a runnable Frida-repo local surface

The Frida repo may keep visualizer source files and package templates, but it must not depend on a local runnable visualizer build lane for correctness.

The intended runtime model is:

- source lives in package/templates
- target repo compiles or bundles it on demand
- output lives in the target repo

### 2. Build on demand in the target repo

When `frida-core visualizer` runs in a legal target repo:

- it must use the target repo’s legal app contract and generated overlay
- it must compile the visualizer from shipped source/templates
- it must emit `dist/visualizer/index.html`

No dependency may remain on a Frida-repo-generated `dist/reference-viewer/**` artifact.

### 3. Replace the list-first runtime with a diagram-first runtime

The runtime must render:

- interactive SVG architecture diagram
- typed nodes and edges
- boundary-first drill-in
- topology / flow / specification as diagram modes

The following may remain only as secondary surfaces:

- inspector detail panels
- debug lists
- raw entity dumps

They must not be the primary startup experience.

### 4. Keep boundary-first navigation

The runtime model must keep boundary-first navigation as canonical:

- start at root boundary
- select without mutating scope
- explicit `enter`
- explicit `up`
- explicit `back`

The runtime must not switch to a global freeform graph exploration model in this task.

### 5. Output location and naming

Canonical output target:

- `dist/visualizer/index.html`

Any legacy `reference-viewer` path must be retired or explicitly deprecated so the product surface has one canonical delivery location.

## Non-Goals

- Do not define legality or zero-start rules here; those belong to contract and dispatch tasks.
- Do not keep backward compatibility with fixture/demo visualizer surfaces.
- Do not embed the visualizer into the target app UI in this task.

## Verification

Run:

```bash
npm run build && node dist/cli.js check contract-set
```

And confirm by implementation review that:

- Frida package still ships visualizer source/templates
- the target repo receives `dist/visualizer/index.html`
- the primary runtime surface is a diagram, not card/list rendering
