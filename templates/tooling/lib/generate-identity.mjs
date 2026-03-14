#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_JSON_PATH = path.resolve('package.json');
const OUTPUT_PATH = path.resolve('src/generated/identity.ts');

function fail(message) {
  console.error(`generate-identity: ${message}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
const packageName = packageJson?.name;
const packageVersion = packageJson?.version;
const binEntries = Object.entries(packageJson?.bin || {});

if (typeof packageName !== 'string' || !packageName.trim()) {
  fail('package.json is missing a valid "name"');
}

if (typeof packageVersion !== 'string' || !packageVersion.trim()) {
  fail('package.json is missing a valid "version"');
}

if (binEntries.length !== 1) {
  fail(`expected exactly 1 bin entry, received ${binEntries.length}`);
}

const [[cliName]] = binEntries;

const nextContent = `// AUTO-GENERATED FROM package.json. DO NOT EDIT MANUALLY.
export const FRIDA_PACKAGE_NAME = ${JSON.stringify(packageName)} as const;
export const FRIDA_PACKAGE_VERSION = ${JSON.stringify(packageVersion)} as const;
export const FRIDA_CLI_NAME = ${JSON.stringify(cliName)} as const;
`;

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

const previousContent = fs.existsSync(OUTPUT_PATH) ? fs.readFileSync(OUTPUT_PATH, 'utf8') : null;
if (previousContent !== nextContent) {
  fs.writeFileSync(OUTPUT_PATH, nextContent, 'utf8');
}
