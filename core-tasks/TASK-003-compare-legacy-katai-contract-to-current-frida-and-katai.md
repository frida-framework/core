---
id: 003-compare-legacy-katai-contract-to-current-frida-and-katai
status: OPEN
profile_id: frida_governance
interface_ref: FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT
title: Compare archived legacy Katai contract build against current Frida and current Katai
summary: Build a strict semantic mapping between the archived legacy Katai contract build and the current Frida and Katai contract surfaces, separating preserved behavior, renamed surfaces, removed legacy mechanics, and unresolved gaps.
acceptance_criteria:
  - The comparison covers archived legacy surfaces, current Frida source/public surfaces, and current Katai app/deployed surfaces from their canonical contract entrypoints.
  - Every compared legacy surface family is classified as preserved, renamed, split, moved, removed, or replaced, with an explicit current owner surface.
  - The result distinguishes Frida-core changes from Katai-app changes and does not collapse them into a single undifferentiated diff.
  - The result includes an explicit list of legacy mechanics still missing in the current model or intentionally dropped.
  - The comparison is semantic and contract-aware, not a raw file-tree diff.
verification_cmd: npm run verify && npm --prefix ../katai-planner run -s frida:validate
---

# TASK-003: Compare Archived Legacy Katai Contract Build Against Current Frida And Current Katai

## Objective

Produce a contract-aware comparison between:

1. the archived legacy Katai contract build in `core/.archive/legacy-katai/`
2. the current Frida source/public contract surfaces in repo `frida`
3. the current deployed and inbox Katai contract surfaces in repo `katai-planner`

The output must explain what was preserved, what was renamed or split, what moved between core and app ownership, what was intentionally removed, and what still looks like a regression or unresolved migration gap.

## Canonical Inputs

### Archived legacy Katai

- `core/.archive/legacy-katai/contract.index.yaml`
- `core/.archive/legacy-katai/contract/frida/contract.index.yaml`
- `core/.archive/legacy-katai/contract/app/contract.index.yaml`
- `core/.archive/legacy-katai/layers/*.yaml`
- `core/.archive/legacy-katai/templates/**`

### Current Frida

- `core/core-contract/contract.index.yaml`
- `core/contract/contract.index.yaml`
- `core/core-contract/layers/*.yaml`
- `core/core-templates/management/**`
- `core/templates/management/**`

### Current Katai

- `katai-planner/.frida/inbox/app-contract/contract.index.yaml`
- `katai-planner/.frida/contract/app/contract.index.yaml`
- `katai-planner/.frida/contract/frida/contract.index.yaml`
- `katai-planner/.frida/inbox/app-contract/layers/*.yaml`

## Required Comparison Axes

### 1. Contract topology and ownership split

Explain how the legacy bundle mixed or separated:

- app contract
- Frida core contract
- deployed mirrors
- templates/tooling

Map each legacy surface to its current owner:

- `frida_core_only`
- `katai_app_only`
- `deployed_projection`
- `removed_legacy_surface`

### 2. Path and surface model

Compare the old path model against the current one:

- legacy path literals and mixed surfaces
- current `core-*` authoring roots
- current public/package roots
- current deployed `.frida/contract/**` and `.frida/inbox/app-contract/**` surfaces

Identify places where a legacy path became:

- a canonical registry path
- a generated projection
- a cleanup-only legacy path
- a removed concept

### 3. Interface and playbook model

Compare the management/playbook surfaces:

- legacy `AGENT-canon-*`
- legacy `templates/management/*`
- current `FRIDA_INTERFACE_*` ownership and repository-scoped surfaces
- current split between `core-templates/management/**` and public `templates/management/**`

Call out any behavior that used to exist in legacy Katai but is now:

- private to Frida
- public and deployable
- removed without replacement

### 4. Generated/deployed artifacts

Compare generated outputs and their target locations:

- AGENTS surfaces
- router/profiles
- docs/policy/reference artifacts
- IR/graph/permissions outputs
- app mirror vs Frida mirror

Explicitly note path moves such as root-level legacy outputs vs current `.frida/contract/**` placement.

### 5. Katai app semantics

Compare old Katai-specific contract semantics against the current `katai-planner` app contract:

- preserved domains and zones
- renamed blocks or moved responsibilities
- model losses
- new Frida-imposed structure that replaced legacy Katai mechanics

Do not stop at structural diff. Explain whether the current Katai contract still captures the same operational meaning.

## Required Output Shape

The comparison result must contain a table with at least these columns:

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|

Allowed `Status` values:

- `preserved`
- `renamed`
- `moved`
- `split`
- `replaced`
- `removed`
- `unresolved`

After the table, include these sections:

1. `Frida-Core Changes`
2. `Katai-App Changes`
3. `Intentional Legacy Removals`
4. `Potential Regressions Or Missing Migrations`
5. `Recommended Follow-up Tasks`

## Method Constraints

- Do not compare only by filename similarity.
- Do not compare only generated-to-generated surfaces.
- Treat `core/core-contract/contract.index.yaml` as the Frida source of truth, not `core/contract/contract.index.yaml`.
- Treat `katai-planner/.frida/inbox/app-contract/contract.index.yaml` as the Katai app source of truth.
- Use public `contract/` and deployed `.frida/contract/frida/` only as projections.
- If a legacy surface has no direct equivalent, mark it explicitly as `removed` or `unresolved`; do not invent soft equivalence.
- If a current surface combines several legacy responsibilities, mark it as `split` or `replaced` and name all affected legacy sources.

## Gemini Flash Guidance

Gemini Flash is acceptable for a first-pass semantic classification only if the input is pre-structured:

- give it inventories or normalized excerpts, not whole repos
- compare one surface family at a time
- require tabular output with the status vocabulary above
- verify every non-trivial claim against the actual files locally

Do not use Gemini Flash as the sole authority for final migration conclusions across the full tree.


## Comparison Result

### Comparison Summary

- Archived legacy bundle inventory: 170 files.
- File-by-file mapping result: 168 legacy files map to current concrete surfaces, 1 file is intentionally removed, and 1 file remains unresolved.
- Most important split: legacy root app authoring moved into `katai-planner/.frida/inbox/app-contract/**`, while legacy Frida deployed mirror now comes from `core/core-contract/**` with public and deployed projections.
- Most important collapse: the archive carried two byte-identical copies of each app-context doc (`docs/**` and `contract/app/docs/**`); current Katai keeps the single app-owned docs surface at `katai-planner/contract/docs/**`.
- Most important exception inside tooling: 92 legacy tooling template files still exist in both `core/templates/tooling/**` and `katai-planner/.frida/templates/tooling/**`; `frida-core-bridge.ts` is the only legacy tooling file that changed semantic role.

### A. Legacy bundle-root app source and runtime surfaces

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|
| `AGENTS.md` | deployed_projection | `katai-planner/.frida/AGENTS.md` | moved | Legacy bundle-root guard file now lives at the app `.frida` root; `katai-planner/.frida/contract/AGENTS.md` separately covers the deployed contract mirror. |
| `cache/CANON_SIGNALS_JSON.json` | removed_legacy_surface | `N/A` | removed | Legacy cache artifact was dropped; current generation/verification computes state directly from contract inputs instead of persisting this cache file. |
| `canon.cbmd.yaml` | katai_app_only + deployed_projection | `katai-planner/.frida/inbox/app-contract/canon.cbmd.yaml`<br>`katai-planner/contract/canon.cbmd.yaml`<br>`katai-planner/.frida/contract/app/canon.cbmd.yaml` | split | Empty sentinel survives, but it is now carried by app source plus app/public and deployed projections instead of the legacy bundle root. |
| `config.yaml` | deployed_projection | `katai-planner/.frida/config.yaml` | moved | Runtime config remained app-local and moved under the strict `.frida` root. |
| `contract.index.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/contract.index.yaml`<br>`katai-planner/contract/contract.index.yaml` | moved | Legacy root app contract source moved into the app repo inbox; `katai-planner/contract/contract.index.yaml` is the app-owned public mirror, not the authoring SSOT. |
| `visual-schema.overlay.json` | deployed_projection | `katai-planner/.frida/contract/visual/canon-overlay.json` | renamed | Legacy root overlay became the app deployed visual artifact and was renamed to the current canonical overlay filename. |
| `docs/app-context.md` | katai_app_only | `katai-planner/contract/docs/app-context.md` | moved | Legacy root app documentation moved into the app-owned `contract/docs` surface; deployed duplicates under `contract/app/docs` were collapsed into the same current file. |
| `docs/project-context.md` | katai_app_only | `katai-planner/contract/docs/project-context.md` | moved | Legacy root app documentation moved into the app-owned `contract/docs` surface; deployed duplicates under `contract/app/docs` were collapsed into the same current file. |
| `layers/agent-framework.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/agent-framework.yaml`<br>`katai-planner/contract/layers/agent-framework.yaml` | moved | App source of truth is now the inbox layer; a trimmed app-owned mirror also exists under `katai-planner/contract/layers/`. |
| `layers/buildtime.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/buildtime.yaml`<br>`katai-planner/contract/layers/buildtime.yaml` | moved | App source of truth is now the inbox layer; a trimmed app-owned mirror also exists under `katai-planner/contract/layers/`. |
| `layers/host-root.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/host-root.yaml` | moved | This layer remains app-owned only in the inbox source contract; there is no separate `katai-planner/contract/layers/` mirror for this file. |
| `layers/profile.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/profile.yaml` | moved | This layer remains app-owned only in the inbox source contract; there is no separate `katai-planner/contract/layers/` mirror for this file. |
| `layers/route.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/route.yaml`<br>`katai-planner/contract/layers/route.yaml` | moved | App source of truth is now the inbox layer; a trimmed app-owned mirror also exists under `katai-planner/contract/layers/`. |
| `layers/shared.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/shared.yaml`<br>`katai-planner/contract/layers/shared.yaml` | moved | App source of truth is now the inbox layer; a trimmed app-owned mirror also exists under `katai-planner/contract/layers/`. |
| `layers/wizard.yaml` | katai_app_only | `katai-planner/.frida/inbox/app-contract/layers/wizard.yaml`<br>`katai-planner/contract/layers/wizard.yaml` | moved | App source of truth is now the inbox layer; a trimmed app-owned mirror also exists under `katai-planner/contract/layers/`. |

### B. Legacy deployed app projection surfaces

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|
| `contract/AGENTS.md` | deployed_projection | `katai-planner/.frida/contract/AGENTS.md` | moved | The deployed contract-mirror guard file still exists, but now in the live app `.frida/contract` tree rather than inside the archived bundle. |
| `contract/app/contract.index.yaml` | deployed_projection | `katai-planner/.frida/contract/app/contract.index.yaml` | moved | App deployed mirror is still generated, but now from `katai-planner/.frida/inbox/app-contract/contract.index.yaml`. |
| `contract/app/docs/app-context.md` | katai_app_only | `katai-planner/contract/docs/app-context.md` | replaced | Legacy deployed duplicate docs were collapsed into the single app-owned docs surface at `katai-planner/contract/docs/` instead of being re-emitted under `.frida/contract/app/docs/`. |
| `contract/app/docs/project-context.md` | katai_app_only | `katai-planner/contract/docs/project-context.md` | replaced | Legacy deployed duplicate docs were collapsed into the single app-owned docs surface at `katai-planner/contract/docs/` instead of being re-emitted under `.frida/contract/app/docs/`. |
| `contract/app/layers/agent-framework.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/agent-framework.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |
| `contract/app/layers/buildtime.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/buildtime.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |
| `contract/app/layers/host-root.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/host-root.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |
| `contract/app/layers/profile.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/profile.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |
| `contract/app/layers/route.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/route.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |
| `contract/app/layers/shared.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/shared.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |
| `contract/app/layers/wizard.yaml` | deployed_projection | `katai-planner/.frida/contract/app/layers/wizard.yaml` | moved | App deployed layer is still emitted, but its source of truth moved to the inbox app contract. |

### C. Legacy deployed Frida contract projection surfaces

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|
| `contract/frida/bootstrap-package.manifest.yaml` | frida_core_only + deployed_projection | `core/core-contract/bootstrap-package.manifest.yaml`<br>`core/contract/bootstrap-package.manifest.yaml`<br>`katai-planner/.frida/contract/frida/bootstrap-package.manifest.yaml` | split | Manifest now exists as Frida source plus package and deployed projections. |
| `contract/frida/contract.index.yaml` | frida_core_only + deployed_projection | `core/core-contract/contract.index.yaml`<br>`core/contract/contract.index.yaml`<br>`katai-planner/.frida/contract/frida/contract.index.yaml` | split | Legacy deployed Frida mirror is now derived from the Frida-core source contract; current repo keeps both the private authoring contract and public/deployed projections. |
| `contract/frida/layers/FL01-identity.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL01-identity.yaml`<br>`core/contract/layers/FL01-identity.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL01-identity.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL02-architecture.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL02-architecture.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL02-architecture.yaml` | split | Layer still exists in Frida source and the deployed app mirror, but it is intentionally omitted from the package/public `core/contract` projection. |
| `contract/frida/layers/FL03-infrastructure.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL03-infrastructure.yaml`<br>`core/contract/layers/FL03-infrastructure.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL03-infrastructure.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL04-core-configuration.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL04-core-configuration.yaml`<br>`core/contract/layers/FL04-core-configuration.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL04-core-configuration.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL05-agent-framework.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL05-agent-framework.yaml`<br>`core/contract/layers/FL05-agent-framework.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL05-agent-framework.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL06-reporting.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL06-reporting.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL06-reporting.yaml` | split | Layer still exists in Frida source and the deployed app mirror, but it is intentionally omitted from the package/public `core/contract` projection. |
| `contract/frida/layers/FL07-cli.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL07-cli.yaml`<br>`core/contract/layers/FL07-cli.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL07-cli.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL08-buildtime.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL08-buildtime.yaml`<br>`core/contract/layers/FL08-buildtime.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL08-buildtime.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL09-bootstrap.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL09-bootstrap.yaml`<br>`core/contract/layers/FL09-bootstrap.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL09-bootstrap.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL10-visualization.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL10-visualization.yaml`<br>`core/contract/layers/FL10-visualization.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL10-visualization.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL11-management.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL11-management.yaml`<br>`core/contract/layers/FL11-management.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL11-management.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL12-wiki.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL12-wiki.yaml`<br>`core/contract/layers/FL12-wiki.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL12-wiki.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/layers/FL13-agent-entry.yaml` | frida_core_only + deployed_projection | `core/core-contract/layers/FL13-agent-entry.yaml`<br>`core/contract/layers/FL13-agent-entry.yaml`<br>`katai-planner/.frida/contract/frida/layers/FL13-agent-entry.yaml` | split | Layer now has three surfaces: Frida authoring source, public package projection, and deployed app mirror. |
| `contract/frida/template-integrity.manifest.yaml` | frida_core_only + deployed_projection | `core/core-contract/template-integrity.manifest.yaml`<br>`core/contract/template-integrity.manifest.yaml`<br>`katai-planner/.frida/contract/frida/template-integrity.manifest.yaml` | split | Manifest now exists as Frida source plus package and deployed projections. |

### D. Legacy deployed artifacts, profiles, and router surfaces

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|
| `contract/artifacts/frida.graph.mmd` | deployed_projection | `katai-planner/.frida/contract/artifacts/frida.graph.mmd` | moved | Generated artifact remains deployed in the app repo under `.frida/contract/artifacts/`. |
| `contract/artifacts/frida.ir.json` | deployed_projection | `katai-planner/.frida/contract/artifacts/frida.ir.json` | moved | Generated artifact remains deployed in the app repo under `.frida/contract/artifacts/`. |
| `contract/artifacts/frida.permissions.json` | deployed_projection | `katai-planner/.frida/contract/artifacts/frida.permissions.json` | moved | Generated artifact remains deployed in the app repo under `.frida/contract/artifacts/`. |
| `contract/profiles/architect_cross_repo.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/architect_cross_repo.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/architect_inbox.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/architect_inbox.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/backend_core.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/backend_core.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/ci_debugger.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/ci_debugger.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/governance.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/governance.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/qa_engineer.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/qa_engineer.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/readonly_observer.xml` | removed_legacy_surface | `N/A` | unresolved | This legacy deployed profile no longer exists in the active current profile set. No direct current replacement was found in Frida or Katai. |
| `contract/profiles/route_tuning.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/route_tuning.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/task_setter.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/task_setter.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/timeline_logic.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/timeline_logic.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/visual_design.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/visual_design.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/profiles/wizard_logic.xml` | deployed_projection | `katai-planner/.frida/contract/profiles/wizard_logic.xml` | moved | Deployed profile remains in the app repo profile set. |
| `contract/specs/ROUTER.xml` | deployed_projection | `katai-planner/.frida/contract/specs/ROUTER.xml` | moved | Router remains a deployed app artifact. |

### E. Legacy non-tooling template surfaces

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|
| `templates/AGENTS.md` | frida_core_only + deployed_projection | `core/templates/AGENTS.md`<br>`katai-planner/.frida/templates/AGENTS.md` | split | Frida keeps the public template authoring copy; Katai also materializes the deployed generated copy under `.frida/templates/`. |
| `templates/config.template.yaml` | deployed_projection | `katai-planner/.frida/templates/config.template.yaml` | moved | Runtime config template is now generated into the app `.frida/templates/` surface instead of being shipped as a literal file in `core/templates/`. |
| `templates/docs-gen/agents-mapper.hbs` | frida_core_only | `core/templates/docs-gen/agents-mapper.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/docs-gen/agents-notouch.hbs` | frida_core_only | `core/templates/docs-gen/agents-notouch.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/docs-gen/agents-readonly.hbs` | frida_core_only | `core/templates/docs-gen/agents-readonly.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/docs-gen/agents-service.hbs` | frida_core_only | `core/templates/docs-gen/agents-service.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/docs-gen/api-reference.hbs` | frida_core_only | `core/templates/docs-gen/api-reference.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/docs-gen/boundaries.hbs` | frida_core_only | `core/templates/docs-gen/boundaries.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/docs-gen/immutability.hbs` | frida_core_only | `core/templates/docs-gen/immutability.hbs` | preserved | Docs-generation template remains in the Frida public template surface. |
| `templates/frida/bootloader.hbs` | frida_core_only | `core/templates/frida/bootloader.hbs` | preserved | Frida bootloader/profile/router template remains in the Frida public template surface. |
| `templates/frida/profile-v2.xml.hbs` | frida_core_only | `core/templates/frida/profile-v2.xml.hbs` | preserved | Frida bootloader/profile/router template remains in the Frida public template surface. |
| `templates/frida/profile.xml.hbs` | frida_core_only | `core/templates/frida/profile.xml.hbs` | preserved | Frida bootloader/profile/router template remains in the Frida public template surface. |
| `templates/frida/router.xml.hbs` | frida_core_only | `core/templates/frida/router.xml.hbs` | preserved | Frida bootloader/profile/router template remains in the Frida public template surface. |
| `templates/management/AGENT-canon-repair.md` | frida_core_only | `core/core-templates/management/AGENT-frida-internal-contract-repair.md`<br>`core/templates/management/AGENT-app-contract-repair.md` | split | Legacy single repair playbook split into private Frida-internal repair plus public app-contract repair. |
| `templates/management/AGENT-canon-update.md` | frida_core_only | `core/core-templates/management/AGENT-frida-internal-contract-update.md`<br>`core/templates/management/AGENT-app-contract-update.md` | split | Legacy single update playbook split into private Frida-internal update plus public app-contract update. |
| `templates/management/AGENT-repo-audit.md` | frida_core_only | `core/templates/management/AGENT-repo-audit.md` | preserved | Public management playbook remains in the Frida template surface. |
| `templates/management/AGENT-task-formulation.md` | frida_core_only | `core/templates/management/AGENT-task-formulation.md` | preserved | Public management playbook remains in the Frida template surface. |
| `templates/scaffold/app-contract/contract.index.yaml` | frida_core_only | `core/templates/template_app_basic/app-contract/contract.index.yaml` | renamed | Legacy scaffold surface was renamed to `template_app_basic` and expanded with additional starter files. |
| `templates/scaffold/package.json` | frida_core_only | `core/templates/template_app_basic/package.json` | renamed | Legacy scaffold surface was renamed to `template_app_basic` and expanded with additional starter files. |

### F. Legacy tooling template surfaces

| Legacy Surface / Concept | Current Owner | Current Path / Ref | Status | Notes |
|---|---|---|---|---|
| `templates/tooling/apply-styles.ts` | frida_core_only + deployed_projection | `core/templates/tooling/apply-styles.ts`<br>`katai-planner/.frida/templates/tooling/apply-styles.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/check-commands-catalog.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/check-commands-catalog.mjs`<br>`katai-planner/.frida/templates/tooling/check-commands-catalog.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/check-deps.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/check-deps.mjs`<br>`katai-planner/.frida/templates/tooling/check-deps.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/check-docs-hygiene.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/check-docs-hygiene.mjs`<br>`katai-planner/.frida/templates/tooling/check-docs-hygiene.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/check-env-vars.ts` | frida_core_only + deployed_projection | `core/templates/tooling/check-env-vars.ts`<br>`katai-planner/.frida/templates/tooling/check-env-vars.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/check-nested-node-modules.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/check-nested-node-modules.mjs`<br>`katai-planner/.frida/templates/tooling/check-nested-node-modules.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/check-password.ts` | frida_core_only + deployed_projection | `core/templates/tooling/check-password.ts`<br>`katai-planner/.frida/templates/tooling/check-password.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/clean-nested-node-modules.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/clean-nested-node-modules.mjs`<br>`katai-planner/.frida/templates/tooling/clean-nested-node-modules.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/compose-route.ts` | frida_core_only + deployed_projection | `core/templates/tooling/compose-route.ts`<br>`katai-planner/.frida/templates/tooling/compose-route.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/detect-test-profile.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/detect-test-profile.mjs`<br>`katai-planner/.frida/templates/tooling/detect-test-profile.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/docs-link-graph.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/docs-link-graph.mjs`<br>`katai-planner/.frida/templates/tooling/docs-link-graph.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/docs-nav-check.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/docs-nav-check.mjs`<br>`katai-planner/.frida/templates/tooling/docs-nav-check.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/e2e-llm-fallback.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/e2e-llm-fallback.mjs`<br>`katai-planner/.frida/templates/tooling/e2e-llm-fallback.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/e2e-route-sharing.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/e2e-route-sharing.mjs`<br>`katai-planner/.frida/templates/tooling/e2e-route-sharing.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/e2e-route-sharing.sh` | frida_core_only + deployed_projection | `core/templates/tooling/e2e-route-sharing.sh`<br>`katai-planner/.frida/templates/tooling/e2e-route-sharing.sh` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/e2e-stops.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/e2e-stops.mjs`<br>`katai-planner/.frida/templates/tooling/e2e-stops.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/e2e-stops.sh` | frida_core_only + deployed_projection | `core/templates/tooling/e2e-stops.sh`<br>`katai-planner/.frida/templates/tooling/e2e-stops.sh` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/ensure-native-bindings.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/ensure-native-bindings.mjs`<br>`katai-planner/.frida/templates/tooling/ensure-native-bindings.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/ensure-rollup-native.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/ensure-rollup-native.mjs`<br>`katai-planner/.frida/templates/tooling/ensure-rollup-native.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/ensure-swc-native.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/ensure-swc-native.mjs`<br>`katai-planner/.frida/templates/tooling/ensure-swc-native.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/frida-check.ts` | frida_core_only + deployed_projection | `core/templates/tooling/frida-check.ts`<br>`katai-planner/.frida/templates/tooling/frida-check.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/frida-contract-adapter.ts` | frida_core_only + deployed_projection | `core/templates/tooling/frida-contract-adapter.ts`<br>`katai-planner/.frida/templates/tooling/frida-contract-adapter.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/frida-core-bridge.ts` | deployed_projection | `katai-planner/.frida/templates/tooling/frida-core-bridge.ts` | replaced | Legacy Frida public template bridge was removed from `core/templates/tooling`; the generated app copy remains, but it is now a thin direct `@sistemado/frida` adapter instead of the old fallback loader. |
| `templates/tooling/frida-gen.ts` | frida_core_only + deployed_projection | `core/templates/tooling/frida-gen.ts`<br>`katai-planner/.frida/templates/tooling/frida-gen.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/frida-hash.ts` | frida_core_only + deployed_projection | `core/templates/tooling/frida-hash.ts`<br>`katai-planner/.frida/templates/tooling/frida-hash.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/frida-migration-report.ts` | frida_core_only + deployed_projection | `core/templates/tooling/frida-migration-report.ts`<br>`katai-planner/.frida/templates/tooling/frida-migration-report.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/generate-city-index.ts` | frida_core_only + deployed_projection | `core/templates/tooling/generate-city-index.ts`<br>`katai-planner/.frida/templates/tooling/generate-city-index.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/generate-routes-status.ts` | frida_core_only + deployed_projection | `core/templates/tooling/generate-routes-status.ts`<br>`katai-planner/.frida/templates/tooling/generate-routes-status.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/generate-segment.ts` | frida_core_only + deployed_projection | `core/templates/tooling/generate-segment.ts`<br>`katai-planner/.frida/templates/tooling/generate-segment.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/context-matcher.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/context-matcher.ts`<br>`katai-planner/.frida/templates/tooling/lib/context-matcher.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/detect-profile.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/lib/detect-profile.mjs`<br>`katai-planner/.frida/templates/tooling/lib/detect-profile.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/e2e-common.sh` | frida_core_only + deployed_projection | `core/templates/tooling/lib/e2e-common.sh`<br>`katai-planner/.frida/templates/tooling/lib/e2e-common.sh` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/frida-errors.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/frida-errors.ts`<br>`katai-planner/.frida/templates/tooling/lib/frida-errors.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/load-contract.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/lib/load-contract.mjs`<br>`katai-planner/.frida/templates/tooling/lib/load-contract.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/mapper-utils.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/mapper-utils.ts`<br>`katai-planner/.frida/templates/tooling/lib/mapper-utils.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/path-normalizer.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/path-normalizer.ts`<br>`katai-planner/.frida/templates/tooling/lib/path-normalizer.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/redirect-resolver.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/redirect-resolver.ts`<br>`katai-planner/.frida/templates/tooling/lib/redirect-resolver.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/source-normalizers.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/source-normalizers.ts`<br>`katai-planner/.frida/templates/tooling/lib/source-normalizers.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/supabase.ts` | frida_core_only + deployed_projection | `core/templates/tooling/lib/supabase.ts`<br>`katai-planner/.frida/templates/tooling/lib/supabase.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/lib/visual-schema-extractor.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/lib/visual-schema-extractor.mjs`<br>`katai-planner/.frida/templates/tooling/lib/visual-schema-extractor.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/manage-prompts.ts` | frida_core_only + deployed_projection | `core/templates/tooling/manage-prompts.ts`<br>`katai-planner/.frida/templates/tooling/manage-prompts.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper-reset.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper-reset.ts`<br>`katai-planner/.frida/templates/tooling/mapper-reset.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/AGENTS.md` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/AGENTS.md`<br>`katai-planner/.frida/templates/tooling/mapper/AGENTS.md` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/mapperContract.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/mapperContract.ts`<br>`katai-planner/.frida/templates/tooling/mapper/mapperContract.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/signer.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/signer.mjs`<br>`katai-planner/.frida/templates/tooling/mapper/signer.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/styler-timeline.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/styler-timeline.ts`<br>`katai-planner/.frida/templates/tooling/mapper/styler-timeline.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/styler-wizard.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/styler-wizard.ts`<br>`katai-planner/.frida/templates/tooling/mapper/styler-wizard.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/surgeon-timeline.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/surgeon-timeline.ts`<br>`katai-planner/.frida/templates/tooling/mapper/surgeon-timeline.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/surgeon-wizard.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/surgeon-wizard.ts`<br>`katai-planner/.frida/templates/tooling/mapper/surgeon-wizard.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/surgeonInstructions.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/surgeonInstructions.ts`<br>`katai-planner/.frida/templates/tooling/mapper/surgeonInstructions.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mapper/validate.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mapper/validate.ts`<br>`katai-planner/.frida/templates/tooling/mapper/validate.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/merge-boundaries.ts` | frida_core_only + deployed_projection | `core/templates/tooling/merge-boundaries.ts`<br>`katai-planner/.frida/templates/tooling/merge-boundaries.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/mount-all.ts` | frida_core_only + deployed_projection | `core/templates/tooling/mount-all.ts`<br>`katai-planner/.frida/templates/tooling/mount-all.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/push-migrations.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/push-migrations.mjs`<br>`katai-planner/.frida/templates/tooling/push-migrations.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/push-migrations.sh` | frida_core_only + deployed_projection | `core/templates/tooling/push-migrations.sh`<br>`katai-planner/.frida/templates/tooling/push-migrations.sh` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/run-docs-fullcheck.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/run-docs-fullcheck.mjs`<br>`katai-planner/.frida/templates/tooling/run-docs-fullcheck.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/run-test-level.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/run-test-level.mjs`<br>`katai-planner/.frida/templates/tooling/run-test-level.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/run-test-ultimate.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/run-test-ultimate.mjs`<br>`katai-planner/.frida/templates/tooling/run-test-ultimate.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/sync-template.ts` | frida_core_only + deployed_projection | `core/templates/tooling/sync-template.ts`<br>`katai-planner/.frida/templates/tooling/sync-template.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/sync-templates-to-wiki.ts` | frida_core_only + deployed_projection | `core/templates/tooling/sync-templates-to-wiki.ts`<br>`katai-planner/.frida/templates/tooling/sync-templates-to-wiki.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/test-glm-route.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/test-glm-route.mjs`<br>`katai-planner/.frida/templates/tooling/test-glm-route.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/test-regression.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/test-regression.mjs`<br>`katai-planner/.frida/templates/tooling/test-regression.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/test-route-generation.ts` | frida_core_only + deployed_projection | `core/templates/tooling/test-route-generation.ts`<br>`katai-planner/.frida/templates/tooling/test-route-generation.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/typecheck-edge.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/typecheck-edge.mjs`<br>`katai-planner/.frida/templates/tooling/typecheck-edge.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/validate-contract.ts` | frida_core_only + deployed_projection | `core/templates/tooling/validate-contract.ts`<br>`katai-planner/.frida/templates/tooling/validate-contract.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/validate-route-config.ts` | frida_core_only + deployed_projection | `core/templates/tooling/validate-route-config.ts`<br>`katai-planner/.frida/templates/tooling/validate-route-config.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify-db.ts` | frida_core_only + deployed_projection | `core/templates/tooling/verify-db.ts`<br>`katai-planner/.frida/templates/tooling/verify-db.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify-fix.ts` | frida_core_only + deployed_projection | `core/templates/tooling/verify-fix.ts`<br>`katai-planner/.frida/templates/tooling/verify-fix.ts` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/ban-initial-mocks-in-mounted.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/ban-initial-mocks-in-mounted.mjs`<br>`katai-planner/.frida/templates/tooling/verify/ban-initial-mocks-in-mounted.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/ban-legacy-imports-in-src.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/ban-legacy-imports-in-src.mjs`<br>`katai-planner/.frida/templates/tooling/verify/ban-legacy-imports-in-src.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/ban-legacy-paths-in-active-zones.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/ban-legacy-paths-in-active-zones.mjs`<br>`katai-planner/.frida/templates/tooling/verify/ban-legacy-paths-in-active-zones.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/ban-old-identifiers-in-src.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/ban-old-identifiers-in-src.mjs`<br>`katai-planner/.frida/templates/tooling/verify/ban-old-identifiers-in-src.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/ban-rogue-mapper-scripts.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/ban-rogue-mapper-scripts.mjs`<br>`katai-planner/.frida/templates/tooling/verify/ban-rogue-mapper-scripts.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/ban-tests-outside-tests-dir.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/ban-tests-outside-tests-dir.mjs`<br>`katai-planner/.frida/templates/tooling/verify/ban-tests-outside-tests-dir.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-agents-contract-set.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-agents-contract-set.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-agents-contract-set.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-frida-core-purity.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-frida-core-purity.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-frida-core-purity.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-generated-docs.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-generated-docs.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-generated-docs.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-mount-integrity.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-mount-integrity.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-mount-integrity.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-param-surface.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-param-surface.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-param-surface.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-pipeline-contracts.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-pipeline-contracts.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-pipeline-contracts.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-schema-axis.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-schema-axis.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-schema-axis.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-verify-visual-separation.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-verify-visual-separation.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-verify-visual-separation.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-visual-contract-consistency.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-visual-contract-consistency.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-visual-contract-consistency.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-visual-no-skip.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-visual-no-skip.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-visual-no-skip.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/check-visual-schema-determinism.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/check-visual-schema-determinism.mjs`<br>`katai-planner/.frida/templates/tooling/verify/check-visual-schema-determinism.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/gate-v2-visual-readiness.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/gate-v2-visual-readiness.mjs`<br>`katai-planner/.frida/templates/tooling/verify/gate-v2-visual-readiness.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/mapper-contract-check.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/mapper-contract-check.mjs`<br>`katai-planner/.frida/templates/tooling/verify/mapper-contract-check.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/mapper-determinism.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/mapper-determinism.mjs`<br>`katai-planner/.frida/templates/tooling/verify/mapper-determinism.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/no-naked-path-literals-in-contract.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/no-naked-path-literals-in-contract.mjs`<br>`katai-planner/.frida/templates/tooling/verify/no-naked-path-literals-in-contract.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/tasks-sessions-append-only.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/tasks-sessions-append-only.mjs`<br>`katai-planner/.frida/templates/tooling/verify/tasks-sessions-append-only.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/tasks-taskpacks-immutable.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/tasks-taskpacks-immutable.mjs`<br>`katai-planner/.frida/templates/tooling/verify/tasks-taskpacks-immutable.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/verify/tasks-taskpacks-schema.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/verify/tasks-taskpacks-schema.mjs`<br>`katai-planner/.frida/templates/tooling/verify/tasks-taskpacks-schema.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |
| `templates/tooling/visual-schema-extract.mjs` | frida_core_only + deployed_projection | `core/templates/tooling/visual-schema-extract.mjs`<br>`katai-planner/.frida/templates/tooling/visual-schema-extract.mjs` | preserved | Legacy tooling template remains present in Frida public templates and is still materialized into the deployed app template tree. |

### Frida-Core Changes

- Legacy `contract/frida/**` files are no longer the Frida source of truth. Their current authoring owner is `core/core-contract/**`, with `core/contract/**` as the package/public projection and `katai-planner/.frida/contract/frida/**` as the deployed app mirror.
- Legacy `templates/management/AGENT-canon-*` mechanics were split by repository scope: Frida-internal authoring now lives in `core/core-templates/management/**`, while app-facing management playbooks stay in `core/templates/management/**`.
- Legacy public tooling templates were preserved almost entirely. The only legacy tooling file not retained in `core/templates/tooling/**` is `templates/tooling/frida-core-bridge.ts`; the bridge behavior moved into direct `@sistemado/frida` imports, while the generated Katai copy remains as a thin compatibility adapter.
- Current Frida adds at least 41 tooling-template files that did not exist in the archive, especially under `core/templates/tooling/lib/**`, `core/templates/tooling/verify/**`, and `core/templates/tooling/visualizer/**`. Those additions do not break backward mapping, but they do mean the current repo is strictly richer than the archived bundle.

### Katai-App Changes

- Legacy root app source files (`contract.index.yaml`, `layers/*.yaml`, `docs/*.md`, `canon.cbmd.yaml`) moved into the live Katai repo. The canonical app contract source is now `katai-planner/.frida/inbox/app-contract/**`, not the Frida repo.
- Katai now keeps a second app-owned public mirror under `katai-planner/contract/**`. That mirror does not fully duplicate the inbox source: `host-root.yaml` and `profile.yaml` remain inbox-only, while app docs live only under `katai-planner/contract/docs/**`.
- The current app contract replaced legacy `PATH_STATUS` with `PATH_NORMALIZATION` and `PATH_SURFACES`, so the mapping is structurally continuous but not textually unchanged.
- Legacy root `visual-schema.overlay.json` is not gone; it now exists as the deployed app visual artifact `katai-planner/.frida/contract/visual/canon-overlay.json`.

### Intentional Legacy Removals

- `cache/CANON_SIGNALS_JSON.json` was intentionally removed. No current concrete cache file replaces it.
- The legacy pattern of duplicating app docs under both root `docs/**` and deployed `contract/app/docs/**` was intentionally removed; current Katai keeps one app-owned docs surface instead.
- The legacy public bridge implementation in `templates/tooling/frida-core-bridge.ts` was intentionally removed from Frida public templates and replaced by direct package imports.

### Potential Regressions Or Missing Migrations

- `contract/profiles/readonly_observer.xml` is the only legacy file left `unresolved` by this comparison. If that profile still has a real operational need, it requires either restoration or an explicit successor mapping.
- `katai-planner/.frida/templates/tooling/frida-core-bridge.ts` still exists in the generated app tree even though Frida public templates no longer ship that file. This is not a false mapping, but it is a divergence worth keeping visible.
- `templates/config.template.yaml` no longer exists as a literal file inside `core/templates/`; it is now produced only in the deployed app surface. That is coherent with the current bootstrap model, but it means archive-to-package path parity was intentionally broken.

### Recommended Follow-up Tasks

- Decide explicitly whether `readonly_observer.xml` was intentionally retired. If yes, document that retirement in the contract or task history; if no, add a successor profile.
- Add a small verifier or report that makes the generated-only status of `.frida/templates/config.template.yaml` and `.frida/templates/tooling/frida-core-bridge.ts` explicit, so future reviews do not misclassify them as missing or stale.
- Keep `core/.archive/legacy-katai/` until one operational trace exercises at least docs generation, visual generation, and profile/router emission in current Katai and confirms there is no hidden behavior still represented only in the archive.
