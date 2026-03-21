# `template_app_basic`

`template_app_basic` is Frida's shipped baseline application contract.

It is a derivative artifact:

- derived from Frida core contract and bootstrap rules
- shipped as a neutral example of an optimal application contract baseline

It is not a source of truth for Frida semantics.

## What this baseline gives you

- a root `AGENTS.md` entry surface
- a deployed Frida control plane under `.frida/**`
- a minimal application contract at `.frida/inbox/app-contract/**`
- inactive example extensions that stay inert until their `AL##` layers are linked in the app contract index

## First use

1. Bootstrap a clean repository with `frida-core bootstrap --target <repo> --mode zero-start`.
2. Install dependencies in the target repository.
3. Verify the deployment with `npm run frida:check`.

Zero-start is deterministic for the same clean input state and the same `@sistemado/frida` package build. Post-generation runs with fixed `generatedAt=1970-01-01T00:00:00.000Z`.

## Public Frida surfaces kept in the app repo

- `AGENTS.md`
- `.frida/config.yaml`
- `.frida/contract/**`
- `.frida/inbox/app-contract/**`
- `.frida/reports/**`
- `.frida/templates/config.template.yaml`

Framework authoring templates such as `.frida/templates/frida/**` and `.frida/templates/docs-gen/**` are intentionally not deployed.

## First edits

- replace placeholder repository metadata in `package.json`
- edit `.frida/inbox/app-contract/contract.index.yaml`
- keep `.frida/inbox/app-contract/layers/AL03-host-root.yaml` as the depth=0 host anchor and extend around it
- activate shipped extensions only by linking their `AL##` layer entries in `.frida/inbox/app-contract/contract.index.yaml`
- expand the baseline layers as the application grows
- use `npm run frida:bootstrap` for later reconcile/repair; do not rerun zero-start after deployment

## Upgrade Frida

For the canonical Frida upgrade path in a target repo, run:

1. `npm install`
2. `npm run frida:migration-report`
3. `npm run frida:bootstrap`
4. align `package.json`, `package-lock.json`, `.frida/inbox/app-contract/**`, `scripts/**`, and `docs/**` as needed
5. `npm run frida:gen`
6. `npm run frida:check:zone`
7. `npm run frida:check:contract-set`

Do not patch generated `.frida/contract/**` manually and do not invent repo-local temporary profiles for this flow.
