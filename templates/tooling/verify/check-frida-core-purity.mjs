#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';

const rootDir = process.cwd();
const legacyCoreRoot = path.join(rootDir, 'packages', 'frida-core');
const forbiddenLegacyImport = /\.\.\/packages\/frida-core\/src\//;

const sourceFiles = globSync('**/*.{ts,tsx,js,mjs,cjs}', {
  cwd: rootDir,
  absolute: true,
  nodir: true,
  ignore: ['**/node_modules/**', 'packages/frida-core/**', 'dist/**', 'build/**'],
}).sort((a, b) => a.localeCompare(b));

const importViolations = [];
for (const file of sourceFiles) {
  const rel = path.relative(rootDir, file).replace(/\\/g, '/');
  const raw = fs.readFileSync(file, 'utf-8');
  if (forbiddenLegacyImport.test(raw)) {
    importViolations.push(rel);
  }
}

if (importViolations.length > 0) {
  console.error('❌ Found legacy local core imports. Use @sistemado/frida package instead:');
  for (const rel of importViolations) {
    console.error(`   - ${rel}`);
  }
  process.exit(1);
}

if (!fs.existsSync(legacyCoreRoot)) {
  console.log('✅ Legacy local frida-core folder removed and no local core imports found');
  process.exit(0);
}

const forbiddenTokens = ['supabase', 'wizard', 'timeline', 'route', 'aistudio', 'katai'];
const allowPathParts = ['/tests/', '/fixtures/'];
const tokenPatterns = forbiddenTokens.map((token) => ({
  token,
  regex: new RegExp(`(^|[^a-z0-9_])${token}([^a-z0-9_]|$)`, 'i'),
}));

const files = globSync('**/*.{ts,js,mjs,cjs,json,hbs,md}', {
  cwd: legacyCoreRoot,
  absolute: true,
  nodir: true,
  ignore: ['**/node_modules/**'],
}).sort((a, b) => a.localeCompare(b));

const purityViolations = [];
for (const file of files) {
  const rel = path.relative(rootDir, file).replace(/\\/g, '/');
  if (allowPathParts.some((part) => rel.includes(part))) {
    continue;
  }

  const raw = fs.readFileSync(file, 'utf-8');
  const lower = raw.toLowerCase();
  for (const tokenPattern of tokenPatterns) {
    if (tokenPattern.regex.test(lower)) {
      purityViolations.push({ file: rel, token: tokenPattern.token });
    }
  }
}

if (purityViolations.length > 0) {
  console.error('❌ frida-core purity check failed. Forbidden app tokens found:');
  for (const violation of purityViolations) {
    console.error(`   - ${violation.file}: ${violation.token}`);
  }
  process.exit(1);
}

console.log('✅ frida-core purity check passed (legacy local package still present)');
