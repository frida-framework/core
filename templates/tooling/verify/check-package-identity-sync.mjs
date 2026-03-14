#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { resolveSourceContractLayerRel } from '../lib/source-contract-paths.mjs';

const ROOT_DIR = process.cwd();
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const GENERATED_IDENTITY_PATH = path.join(ROOT_DIR, 'src', 'generated', 'identity.ts');
const CONTRACT_IDENTITY_PATH = path.join(ROOT_DIR, resolveSourceContractLayerRel('FL01-identity.yaml', ROOT_DIR));
const TEMPLATE_PACKAGE_PATH = path.join(ROOT_DIR, 'templates', 'template_app_basic', 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractConst(raw, name) {
  const pattern = new RegExp(`export const ${name} = ['"]([^'"]+)['"] as const;`);
  const match = raw.match(pattern);
  return match ? match[1] : null;
}

const pkg = readJson(PACKAGE_JSON_PATH);
const generatedIdentity = fs.readFileSync(GENERATED_IDENTITY_PATH, 'utf8');
const contractIdentity = YAML.parse(fs.readFileSync(CONTRACT_IDENTITY_PATH, 'utf8'));
const templatePackage = readJson(TEMPLATE_PACKAGE_PATH);

const expectedPackageName = pkg.name;
const expectedPackageVersion = pkg.version;
const expectedCliName = Object.keys(pkg.bin || {});
const failures = [];

if (expectedCliName.length !== 1) {
  failures.push(`package.json must expose exactly one bin entry; found ${expectedCliName.length}`);
}

const generatedPackageName = extractConst(generatedIdentity, 'FRIDA_PACKAGE_NAME');
const generatedPackageVersion = extractConst(generatedIdentity, 'FRIDA_PACKAGE_VERSION');
const generatedCliName = extractConst(generatedIdentity, 'FRIDA_CLI_NAME');

if (generatedPackageName !== expectedPackageName) {
  failures.push(`src/generated/identity.ts package name mismatch (${generatedPackageName} !== ${expectedPackageName})`);
}

if (generatedPackageVersion !== expectedPackageVersion) {
  failures.push(`src/generated/identity.ts package version mismatch (${generatedPackageVersion} !== ${expectedPackageVersion})`);
}

if (generatedCliName !== expectedCliName[0]) {
  failures.push(`src/generated/identity.ts CLI name mismatch (${generatedCliName} !== ${expectedCliName[0]})`);
}

if (contractIdentity?.CONTRACT_META?.scope?.package !== expectedPackageName) {
  failures.push(
    `${resolveSourceContractLayerRel('FL01-identity.yaml', ROOT_DIR)} package mismatch (${contractIdentity?.CONTRACT_META?.scope?.package} !== ${expectedPackageName})`,
  );
}

const templateDependency = templatePackage?.devDependencies?.[expectedPackageName];
const expectedTemplateDependency = `^${expectedPackageVersion}`;
if (templateDependency !== expectedTemplateDependency) {
  failures.push(`templates/template_app_basic/package.json dependency mismatch (${templateDependency} !== ${expectedTemplateDependency})`);
}

if (failures.length > 0) {
  console.error('❌ Package identity sync check failed:');
  for (const failure of failures) {
    console.error(`   - ${failure}`);
  }
  process.exit(1);
}

console.log('✅ Package identity is synchronized across package.json, generated identity, and template surfaces');
