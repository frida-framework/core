# @sistemado/frida — Frida Core

> **Contract-driven code generation and agent orchestration kernel.**

## Key concepts

- **Contract** — YAML contract that drives all generation. Single source of truth.
- **Zones** — `ZONES` is the public zone model for target repos. Private Frida-repo routing entities live only in `INT_FRIDA_ZONES`. Each resolved zone has its own `AGENTS.md`.
- **Layers** — Contract is split into focused files, assembled at load time.
- **Visibility** — `FRIDA_INTERFACE_*` blocks are public by default unless `_visibility: private` is set explicitly. `build --public` strips private blocks.
- **Visual overlay** — read-only JSON derived from contract truth. UI/runtime consume `.frida/contract/visual/canon-overlay.json` (or `PATHS.visual.overlayFile`) instead of re-deriving visual semantics from raw contract. `npm run frida:visual` materializes the canonical artifact, and `npm run verify:visual` now requires it to exist and stay fresh.
- **Viewer runtime contract** — runtime navigation state is a separate overlay-consuming layer with its own vocabulary: `scope`, `focus`, `lod`, `context_shell`, `enter`, `peek`, `back`, `up`, `trace`, `navigation_stack`.
- **Visualizer** — `frida-core visualizer` builds a diagram-first interactive HTML viewer in a **target app repo**. The visualizer is illegal to run inside the Frida repo itself. Source and templates ship with the package; the target repo performs the on-demand build and receives `dist/visualizer/index.html`.
- **Self-management** — `FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT` is private, repo-local to `frida`, and is not deployed into target repos.
- **Task surface** — In repo `frida`, only `core-tasks/TASK-*.md` is allowed. `tasks/` is forbidden in repo `frida`; `core-tasks/` is forbidden outside repo `frida`.
- **Templates** — `.hbs` files are source of truth. Drift detected via SHA-256 manifest.

Self-repo authoring surfaces live in `core-contract/`, `core-templates/`, and `core-tasks/`.
Public/package surfaces live in `contract/` and `templates/`.
Modular `core-contract/contract.index.yaml` is authoritative in repo `frida`; `contract/contract.index.yaml` is the generated public package projection.
Projected public layers live under `contract/public-layers/*.public.yaml`, so they are visually and mechanically distinct from the canonical authoring layers in `core-contract/layers/*.yaml`.
Assembled snapshot `contract/contract.cbmd.yaml` references are compatibility-only and must not be used as the active source.

## CLI

```sh
frida-core gen                    # validate + normalize + generate
frida-core build                  # assemble contract → dist/contract.assembled.yaml
frida-core build --public         # public blocks only → dist/contract.public.yaml
frida-core check --path <dir>     # resolve zone for a directory
frida-core bootstrap --target <dir>                   # warm reconcile (default)
frida-core bootstrap --target <dir> --mode zero-start # first-time onboarding for clean repos
frida-core bootstrap --target <dir> --mode cold-engine  # engine-only first-time deploy
frida-core visual [--check]       # build or check visual overlay schema v1 at PATHS.visual.overlayFile
frida-core visualizer                      # build visualizer in a target app repo (illegal in Frida repo)
frida-core hash --check           # verify template integrity
frida-core init                   # normalize reporting config
frida-core migration-report       # report deprecated contract fields
```

## Zero-start bootstrap

Use `zero-start` mode when onboarding a **clean repository** (no existing Frida markers):

```sh
frida-core bootstrap --target <repo-dir> --mode zero-start
```

### Prerequisites

- Node.js ≥ 20.
- Run the first bootstrap from a built `@sistemado/frida` package checkout (`node dist/cli.js ...`) before `npm install` exists in the target repo.
- Target repository must not contain existing Frida markers (`.frida/**`, `.frida/inbox/app-contract/**`, or FRIDA bootloader `AGENTS.md`).

### What it creates

- Full cold-engine FRIDA infrastructure from the package reference:
  - `AGENTS.md`
  - `.frida/contract/**`
  - `.frida/templates/**`
  - `.frida/config.yaml`
  - `.frida/contract/docs/policy/**`
  - `scripts/verify/check-agents-contract-set.mjs`
- Scaffold files seeded only when absent:
  - `README.md`
  - `package.json`
  - `.frida/inbox/app-contract/contract.index.yaml`
  - `.frida/inbox/app-contract/layers/AL01-shared.yaml`
  - `.frida/inbox/app-contract/layers/AL02-agent-framework.yaml`
  - `.frida/inbox/app-contract/extensions/AL11-extension_backend.yaml`
  - `.frida/inbox/app-contract/extensions/AL12-extension_backend_supabase.yaml`

### After bootstrap

```sh
cd <repo-dir>
npm install              # installs @sistemado/frida
npm run frida:check      # verify zone resolution + contract-set alignment
# Edit .frida/inbox/app-contract/contract.index.yaml and layers/* — replace placeholders and expand the app contract
npm run frida:gen        # regenerate after contract edits
npm run frida:bootstrap  # subsequent reconcile/repair (warm mode)
```

### Determinism and repeatability

- Zero-start post-generation runs with fixed `generatedAt=1970-01-01T00:00:00.000Z`.
- Identical clean input tree + identical `@sistemado/frida` package contents yield byte-identical zero-start output.
- Re-running zero-start on an already-deployed repository fails immediately with `ZERO_START_ALREADY_DEPLOYED`.
- After onboarding, use `frida-core bootstrap --target <dir>` (warm mode) for subsequent reconcile/repair.

### Dry run

```sh
frida-core bootstrap --target <repo-dir> --mode zero-start --dry-run
```

Prints the plan without writing any files.

### Contract build

The assembled contract is a **build artifact** — run `frida-core build` to produce generated output under `dist/`.

## Package API

```ts
import { runFridaGeneration, runFridaMigrationReport, loadContractDocument } from '@sistemado/frida';
```

## Development

```sh
npm run clean             # remove dist/
npm run build             # compile TypeScript
npm run verify            # build + migration report + zone/contract checks + zero-start determinism
npm run verify:zero-start # zero-start determinism + required-output check
```

## What's in this repository

| Directory | Contents |
|-----------|----------|
| `core-contract/` | Private authoring source of truth for Frida contract and package manifests |
| `core-contract/contract.index.yaml` | Self-repo authoring contract entry point |
| `core-templates/management/` | Private self-repo management playbooks that must never ship |
| `core-tasks/` | Private self-repo task surface |
| `contract/` | Generated public contract projection shipped in the npm package; projected layers live under `contract/public-layers/*.public.yaml` |
| `contract/contract.index.yaml` | Public package contract entry point |
| `contract/template-integrity.manifest.yaml` | Generated public template hash manifest for shipped templates |
| `schemas/` | JSON Schemas for contract, runtime config, session reports |
| `src/` | TypeScript source — loader, generator, CLI, zone-check, visual, viewer-runtime |
| `templates/` | Public/package-visible templates and playbooks |
| `dist/` | Build artifacts — compiled JS + assembled contract (generated, not committed) |

## Contract structure

The contract is split into numbered Frida layers. Core layers use `FL##-*`; Frida-managed app-template layers use `AL##-*`.

| Layer | Visibility | Keywords |
|-------|-----------|----------|
| `FL01 identity` | private | schema, version, meta, source-blocks, selectors |
| `FL02 architecture` | private | ADR, decisions, principles, design, rationale |
| `FL03 infrastructure` | mixed | paths, config, zones, routing, normalization |
| `FL04 core-configuration` | mixed | config, runtime paths, reporting |
| `FL05 agent-framework` | private | agent, routing, profiles, invariants, guards, session |
| `FL06 reporting` | private | report, validation, consistency, verification |
| `FL07 cli` | public | CLI, commands, hash, integrity, integration |
| `FL08 buildtime` | public | generator, mapper, bootstrap tooling |
| `FL09 bootstrap` | public | bootstrap and reconcile semantics |
| `FL10 visualization` | public | visual, overlay, LOD, edges, graph, determinism |
| `FL11 management` | mixed | guard-spec, antitask, verify, update, taskset |
| `FL12 wiki` | public | wiki/SSOT sync |
| `FL13 agent-entry` | mixed | entry protocol, interface routing, clause refs |

Public/package projections keep the same layer ids, but their files are intentionally renamed and relocated under `contract/public-layers/*.public.yaml`. The canonical authoring entity stays only in `core-contract/layers/*.yaml`; the package surface is explicitly a projection, not a second source of truth.
