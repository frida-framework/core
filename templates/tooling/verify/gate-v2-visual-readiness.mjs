#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..', '..');

const checks = [
  {
    id: 'schema_axis',
    command: ['node', 'scripts/verify/check-schema-axis.mjs'],
    description: 'Contract passes strict schema axis checks',
  },
  {
    id: 'contract_consistency',
    command: ['node', 'scripts/verify/check-visual-contract-consistency.mjs'],
    description: 'No dangling visual contract references',
  },
  {
    id: 'visual_on_demand',
    command: ['node', 'scripts/visual-schema-extract.mjs'],
    description: 'Visual artifacts can be generated on demand',
  },
  {
    id: 'no_skip_visual',
    command: ['node', 'scripts/verify/check-visual-no-skip.mjs'],
    description: 'Visual pipeline is fail-hard (no silent skip)',
  },
  {
    id: 'determinism',
    command: ['node', 'scripts/verify/check-visual-schema-determinism.mjs'],
    description: 'Visual determinism check passes for overlay-only extraction',
  },
  {
    id: 'verify_separation',
    command: ['node', 'scripts/verify/check-verify-visual-separation.mjs'],
    description: 'verify and verify:visual pipelines are separated',
  },
];

function runCheck(check) {
  const result = spawnSync(check.command[0], check.command.slice(1), {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    ...check,
    exitCode: typeof result.status === 'number' ? result.status : 2,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function main() {
  console.log('🔍 Gate V2 readiness check (schema-first + on-demand visual)...\n');
  const results = checks.map(runCheck);
  const failed = results.filter((item) => item.exitCode !== 0);

  for (const item of results) {
    const status = item.exitCode === 0 ? 'PASS' : 'FAIL';
    console.log(`- ${item.id}: ${status} (${item.description})`);
    if (item.exitCode !== 0) {
      const preview = (item.stderr || item.stdout).trim();
      if (preview) {
        const lines = preview.split(/\r?\n/).slice(0, 4);
        for (const line of lines) {
          console.log(`    ${line}`);
        }
      }
    }
  }

  if (failed.length > 0) {
    console.log('\n❌ Gate verdict: NOT_READY');
    console.log('Blockers:');
    for (const item of failed) {
      console.log(`- ${item.id}`);
    }
    process.exit(1);
  }

  console.log('\n✅ Gate verdict: READY');
  process.exit(0);
}

main();
