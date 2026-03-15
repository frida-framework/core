#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.cwd());
const PACKAGE_FILE = path.join(ROOT_DIR, 'package.json');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadScripts() {
  if (!fs.existsSync(PACKAGE_FILE)) {
    fail(`package.json not found: ${path.relative(ROOT_DIR, PACKAGE_FILE)}`);
  }

  const pkg = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  const scripts = pkg?.scripts || {};

  if (typeof scripts.verify !== 'string') {
    fail('scripts.verify is missing or invalid.');
  }
  if (typeof scripts['verify:visual'] !== 'string') {
    fail("scripts['verify:visual'] is missing or invalid.");
  }

  return scripts;
}

function includesAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

function main() {
  console.log('🔍 Checking verify/verify:visual separation...');
  const scripts = loadScripts();

  const verifyScript = scripts.verify;
  const verifyVisualScript = scripts['verify:visual'];

  const forbiddenInVerify = [
    'frida:visual',
    'check-visual-contract-consistency',
    'check-visual-schema-determinism',
    'check-visual-diff-schema',
    'verify:visual',
  ];

  if (includesAny(verifyScript, forbiddenInVerify)) {
    fail('scripts.verify must not depend on visual stage commands.');
  }

  const requiredInVerifyVisual = [
    'check-visual-contract-consistency',
    'frida:visual',
    'check-visual-schema-determinism',
  ];

  for (const required of requiredInVerifyVisual) {
    if (!verifyVisualScript.includes(required)) {
      fail(`scripts['verify:visual'] must include '${required}'.`);
    }
  }

  console.log('✅ verify and verify:visual are separated');
}

try {
  main();
} catch (error) {
  fail(`check-verify-visual-separation failed: ${error instanceof Error ? error.message : String(error)}`);
}
