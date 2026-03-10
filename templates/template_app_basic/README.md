# FRIDA Zero-Start `template_app_basic`

This repository was initialized by `frida-core bootstrap --mode zero-start` using the neutral app template `template_app_basic`.

## Zero-start contract

Zero-start is valid only for a clean repository:

- no deployed FRIDA markers in `.frida/**`
- no existing `.frida/inbox/app-contract/**`
- no FRIDA bootloader `AGENTS.md`

Under the same initial repository state and the same `@frida-framework/core` package build, zero-start is deterministic and must produce the same file contents. The FRIDA post-generation step runs with fixed `generatedAt=1970-01-01T00:00:00.000Z`.

## Exact first run

1. Bootstrap from the FRIDA core package checkout:

```sh
cd ../frida
npm run build
node dist/cli.js bootstrap --target ../<repo-dir> --mode zero-start
```

2. Install dependencies and verify this repository:

```sh
cd ../<repo-dir>
npm install
npm run frida:check
```

## Files created by zero-start

- `README.md`
- `package.json`
- `AGENTS.md`
- `.frida/config.yaml`
- `.frida/contract/**`
- `.frida/templates/**`
- `.frida/inbox/app-contract/contract.index.yaml`
- `.frida/inbox/app-contract/layers/AL01-shared.yaml`
- `.frida/inbox/app-contract/layers/AL02-agent-framework.yaml`
- `.frida/inbox/app-contract/layers/AL03-host-root.yaml`
- `.frida/inbox/app-contract/extensions/AL11-extension_backend.yaml`
- `.frida/inbox/app-contract/extensions/AL12-extension_backend_supabase.yaml`
- `.frida/contract/docs/policy/**`
- `scripts/verify/check-agents-contract-set.mjs`

## Next edits after zero-start

- replace placeholder metadata in `package.json`
- edit `.frida/inbox/app-contract/contract.index.yaml`
- treat `.frida/inbox/app-contract/layers/AL03-host-root.yaml` as the depth=0 host anchor; extend around it rather than deleting it
- activate shipped extensions by linking their `AL##` layer entries in `.frida/inbox/app-contract/contract.index.yaml`
- expand `.frida/inbox/app-contract/layers/*` as the repository grows
- use `npm run frida:bootstrap` for later reconcile/repair; do not rerun zero-start

If zero-start is invoked again after deployment, it must fail with `ZERO_START_ALREADY_DEPLOYED`.
