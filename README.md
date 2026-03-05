# @hanszel/core — Frida Core

> **Contract-driven code generation and agent orchestration kernel.**

## What's in this repository

| Directory | Contents |
|-----------|----------|
| `contract/` | Canon — source of truth for all generation and agent behavior |
| `contract/contract.index.yaml` | Modular contract index (entry point) |
| `contract/layers/` | 12 contract layers — each a focused slice of the contract |
| `contract/template-integrity.manifest.yaml` | SHA-256 hash manifest for template drift detection |
| `schemas/` | JSON Schemas for canon, runtime config, session reports |
| `src/` | TypeScript source — loader, generator, CLI, zone-check, visual |
| `templates/` | Handlebars templates for generated artifacts (AGENTS.md, profiles, docs) |
| `dist/` | Build artifacts — compiled JS + assembled canon (generated, not committed) |

## Contract structure

The contract is split into 12 layers. Each layer has `keywords` for contextual lookup:

| Layer | Visibility | Keywords |
|-------|-----------|----------|
| `identity` | private | schema, version, meta, source-blocks, selectors |
| `architecture` | private | ADR, decisions, principles, design, rationale |
| `infrastructure` | mixed | paths, config, zones, routing, normalization |
| `agent-framework` | mixed | agent, routing, profiles, invariants, guards, session |
| `reporting` | private | report, validation, consistency, verification |
| `cli` | public | CLI, commands, hash, integrity, integration |
| `buildtime` | public | generator, mapper, bootstrap |
| `visualization` | public | visual, overlay, LOD, edges, graph, determinism |
| `management` | mixed | guard-spec, antitask, verify, update, taskset |

The assembled contract is a **build artifact** — run `frida-core build` to produce generated output under `dist/`.

## CLI

```sh
frida-core gen                    # validate + normalize + generate
frida-core build                  # assemble canon → dist/canon.assembled.yaml
frida-core build --public         # public blocks only → dist/canon.public.yaml
frida-core check --path <dir>     # resolve zone for a directory
frida-core bootstrap --target <dir>  # explicit zero-deploy bootstrap (guarded)
frida-core visualize [--check]    # build or check visual overlay
frida-core hash --check           # verify template integrity
frida-core init                   # normalize reporting config
frida-core migration-report       # report deprecated canon fields
```

## Key concepts

- **Contract** — YAML contract that drives all generation. Single source of truth.
- **Zones** — Directory-scoped routing regions. Each zone has its own `AGENTS.md`.
- **Layers** — Contract is split into focused files, assembled at load time.
- **Visibility** — Blocks are `public` (external API) or `private` (internal). `build --public` strips private blocks.
- **Templates** — `.hbs` files are source of truth. Drift detected via SHA-256 manifest.

Modular `contract/contract.index.yaml` is authoritative.
Assembled snapshot `contract/contract.cbmd.yaml` references are compatibility-only and must not be used as the active source.

## Package API

```ts
import { runFridaGeneration, runFridaMigrationReport, loadContractDocument } from '@hanszel/core';
```

## Development

```sh
npm run build       # compile TypeScript
npm run verify      # lint + type-check + test
npm run frida:gen   # run generation pipeline
npm run frida:hash  # regenerate template hash manifest
```
