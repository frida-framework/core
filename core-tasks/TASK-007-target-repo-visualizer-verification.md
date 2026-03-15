---
id: 007-target-repo-visualizer-verification
status: OPEN
profile_id: frida_governance
interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
title: Move visualizer runtime verification to legal target repos
summary: Remove Frida-repo runtime verification for the visualizer and define target-repo-only smoke and gating checks based on real app-contract inputs.
acceptance_criteria:
  - Frida repo keeps only static legality and contract checks for the visualizer surface.
  - Runtime and smoke verification for the visualizer execute only in legal target repos.
  - Target-repo verification uses the real app contract and real generated overlay, not fixtures, demos, or template contracts.
  - Zero-start remains enable-only and does not auto-generate visualizer artifacts during verification.
verification_cmd: npm run build && node dist/cli.js check contract-set
---

# TASK-007: Move Visualizer Runtime Verification To Legal Target Repos

## Objective

Relocate visualizer verification to the only place where the feature is legal:

- legal target app repositories with `.frida/inbox/app-contract/contract.index.yaml`

After this task:

- `C:\Projectx1\frida` retains only static legality and contract checks
- runtime smoke checks happen only in target repos
- fixture/template/demo inputs are forbidden for visualizer verification

This task depends on Block 1 and on TASK-004 through TASK-006.

## Required Changes

### 1. Remove Frida-repo runtime verification

The Frida repo must no longer verify the visualizer by:

- generating runtime HTML locally
- opening local runtime assets against demo overlays
- validating runtime behavior against template app contracts

Only static checks remain valid in the Frida repo:

- legality surface checks
- contract consistency checks
- no-fixture checks
- no-template-execution checks

### 2. Define target-repo-only runtime verification

Add the product verification model to target repos:

- generate overlay from the legal app contract
- build visualizer artifact in the target repo
- verify `dist/visualizer/index.html`
- verify startup render uses the real app overlay

The target-repo smoke path must not accept:

- template app contracts from the Frida repo
- fixture overlays
- demo overlays
- Frida repo contract surfaces

### 3. Verify real target app inputs only

The intended smoke path must use:

- `.frida/inbox/app-contract/contract.index.yaml`
- generated overlay derived from that contract

It must confirm:

- HTML artifact exists
- diagram surface exists
- render uses real nodes/edges from the target overlay
- no illegal input surface is involved

### 4. Preserve zero-start semantics

Verification design must not accidentally turn zero-start into an auto-visualizer flow.

Keep these rules:

- zero-start seeds app contract first
- zero-start does not auto-generate visualizer artifact
- visualizer verification becomes legal only after target repo has a legal seeded contract and explicit visualizer invocation

## Non-Goals

- Do not reintroduce fixture-based test coverage for convenience.
- Do not use the template app inside the Frida repo as a surrogate runtime lane.
- Do not move generic contract-set verification out of the Frida repo.

## Verification

Run:

```bash
npm run build && node dist/cli.js check contract-set
```

Implementation completion should also define a target-repo verification sequence equivalent to:

```bash
cd <target-repo>
npm run frida:visual
npm run frida:visualizer
```

with explicit checks that real app-contract inputs were used.
