#!/usr/bin/env node
import { detectProfile } from './lib/detect-profile.mjs';

const result = await detectProfile();

console.log('Detected test profile summary:');
console.log(JSON.stringify(result, null, 2));
console.log(`
Запустите: ${result.recommendedCommand}
Если профиль кажется неверным, выберите его вручную в docs/guides/testing/README.md.
`);

process.exit(0);
