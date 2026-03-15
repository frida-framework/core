---
id: 005-target-repo-only-visualizer-dispatch
status: OPEN
profile_id: frida_governance
interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
title: Add target-repo-only visualizer dispatch with hard legality gate
summary: Introduce frida-core visualizer with an explicit legality gate so the command is runnable only in a target app repo with a legal app contract root.
acceptance_criteria:
  - Frida CLI exposes a canonical visualizer command intended for target repos.
  - The command hard-fails in C:\Projectx1\frida and other repos without a legal app contract root.
  - The legality gate accepts only .frida/inbox/app-contract/contract.index.yaml as the app contract root.
  - Zero-start semantics remain enable-only and do not auto-run the visualizer.
verification_cmd: npm run build && node dist/cli.js check contract-set
---

# TASK-005: Add Target-Repo-Only Visualizer Dispatch With Hard Legality Gate

## Objective

Define and implement a canonical visualizer dispatch path that is legal only in target application repositories.

The command introduced by this task must:

- exist as the product entry point for the visualizer
- refuse to execute in `C:\Projectx1\frida`
- refuse to execute against template contracts or other non-app surfaces
- require a legal app contract at `.frida/inbox/app-contract/contract.index.yaml`

This task depends on Block 1 having already made those legality rules normative.

## Required Changes

### 1. Introduce canonical command surface

Add `frida-core visualizer` as the canonical command surface.

This command replaces the old viewer framing. If legacy aliases remain temporarily for compatibility, they must route through the same legality gate and must not preserve any forbidden Frida-repo execution path.

### 2. Add hard legality gate

The dispatch path must explicitly reject execution when:

- current repo is `C:\Projectx1\frida`
- the repo does not contain `.frida/inbox/app-contract/contract.index.yaml`
- the effective input contract resolves to `templates/template_app_basic/app-contract/contract.index.yaml`
- the input resolves to any fixture or demo overlay surface

The failure must be explicit and actionable, not silent.

### 3. Bind legality to target repo contract root only

The only accepted legal app contract root for the visualizer is:

- `.frida/inbox/app-contract/contract.index.yaml`

The following are explicitly non-legal inputs for visualizer execution:

- `templates/template_app_basic/app-contract/contract.index.yaml`
- `core-contract/**`
- `contract/**` in the Frida repo
- fixture/demo overlay files

### 4. Keep zero-start sequencing strict

This task must preserve the intended sequencing:

1. zero-start seeds the derivative app contract into the target repo
2. only after that seeded contract exists does the visualizer become legal
3. zero-start itself does not auto-run the visualizer

### 5. Update docs and command help

Any CLI help or README guidance must state:

- visualizer is a target-repo command
- Frida repo is not a legal execution context
- template app in the Frida repo is not a legal app contract for visualizer execution

## Non-Goals

- Do not implement the browser runtime or diagram surface here.
- Do not add target-repo smoke verification here.
- Do not auto-run visualizer after zero-start.

## Verification

Run:

```bash
npm run build && node dist/cli.js check contract-set
```

Then verify behavior manually:

- `frida-core visualizer` fails in `C:\Projectx1\frida`
- failure mentions missing or illegal app contract context
- help text and documentation point users to target repos only
