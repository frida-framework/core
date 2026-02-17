# @hanszel/core

Schema-driven Frida Core generation engine.

## CLI

```bash
frida-core gen --strict-schema
frida-core migration-report --strict
frida-core check zone --path scripts/mapper --format text
frida-core hash
```

## Package API

```ts
import { runFridaGeneration, runFridaMigrationReport } from '@hanszel/core';
```

Use adapters to attach host-specific generators and selector packs.
