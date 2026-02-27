#!/usr/bin/env node

/**
 * check-pipeline-contracts.mjs
 *
 * Verifies that every mandatory pipeline file in ROUTE_PIPELINE_CONTRACT
 * exports a FRIDA_CONTRACT with valid stageId, role, and errorStrategy.
 *
 * Exit 1 on any violation.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../..');

// ─── Contract mirror ───────────────────────────────────────────────────────────

const PIPELINE_DIR = 'supabase/functions/v2-upd-route-details';

// mandatory_files from contract:ROUTE_PIPELINE_CONTRACT + waypoint-detectors.ts
const MANDATORY_FILES = [
    'index.ts',
    'types.ts',
    'waypoint-config.ts',
    'waypoint-detection.ts',
    'waypoint-generator.ts',
    'serpentine-detector-v2.ts',
    'highway-change-detector.ts',
    'mapbox.ts',
    'geometry-hash.ts',
    'waypoint-detectors.ts',
];

// Also check that the frida-contract.ts type definition exists
const CONTRACT_TYPE_FILE = 'frida-contract.ts';

// Valid contract stage IDs (from contract:ROUTE_PIPELINE_CONTRACT)
const VALID_STAGE_IDS = new Set([
    '*',                                        // orchestrator / config / types
    '0.routeWaypoints',
    '1.directions',
    '2.detect_potentials',
    '2.detect_potentials.serpentine',
    '2.detect_potentials.highway_change',
    '2.detect_potentials.system',
    '3.generate_waypoints_and_segments',
    '5.database_write',
]);

const VALID_ROLES = new Set([
    'orchestrator', 'stage', 'detector', 'helper', 'config', 'types',
]);

const VALID_ERROR_STRATEGIES = new Set([
    'throw', 'empty-array', 'passthrough',
]);

// ─── Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract FRIDA_CONTRACT from file content using regex.
 * Returns null if not found, or an object with extracted fields.
 */
function extractContract(content) {
    // Match: export const FRIDA_CONTRACT: FridaContract = { ... };
    const re = /export\s+const\s+FRIDA_CONTRACT\s*:\s*FridaContract\s*=\s*\{([^}]+)\}/s;
    const m = content.match(re);
    if (!m) return null;

    const block = m[1];

    const getString = (key) => {
        const r = new RegExp(`${key}\\s*:\\s*['"]([^'"]+)['"]`);
        const mm = block.match(r);
        return mm ? mm[1] : undefined;
    };
    const getBool = (key) => {
        const r = new RegExp(`${key}\\s*:\\s*(true|false)`);
        const mm = block.match(r);
        return mm ? mm[1] === 'true' : undefined;
    };

    return {
        stageId: getString('stageId'),
        role: getString('role'),
        input: getString('input'),
        output: getString('output'),
        pure: getBool('pure'),
        errorStrategy: getString('errorStrategy'),
    };
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log('🔍 Checking pipeline contract interfaces...\n');

const errors = [];
let checked = 0;

// 1. Check frida-contract.ts type file exists
const typeFilePath = join(ROOT, PIPELINE_DIR, CONTRACT_TYPE_FILE);
if (!existsSync(typeFilePath)) {
    errors.push(`Missing type definition: ${PIPELINE_DIR}/${CONTRACT_TYPE_FILE}`);
} else {
    const typeContent = readFileSync(typeFilePath, 'utf-8');
    if (!typeContent.includes('export interface FridaContract')) {
        errors.push(`${CONTRACT_TYPE_FILE} does not export FridaContract interface`);
    }
    console.log(`  ✓ ${CONTRACT_TYPE_FILE} — type definition OK`);
}

// 2. Check each mandatory file
for (const filename of MANDATORY_FILES) {
    const filePath = join(ROOT, PIPELINE_DIR, filename);

    if (!existsSync(filePath)) {
        errors.push(`Missing mandatory file: ${PIPELINE_DIR}/${filename}`);
        continue;
    }

    const content = readFileSync(filePath, 'utf-8');
    const contract = extractContract(content);
    checked++;

    if (!contract) {
        errors.push(`${filename}: missing FRIDA_CONTRACT export`);
        continue;
    }

    // Validate stageId
    if (!contract.stageId) {
        errors.push(`${filename}: FRIDA_CONTRACT.stageId is missing`);
    } else if (!VALID_STAGE_IDS.has(contract.stageId)) {
        errors.push(`${filename}: FRIDA_CONTRACT.stageId "${contract.stageId}" not in contract`);
    }

    // Validate role
    if (!contract.role) {
        errors.push(`${filename}: FRIDA_CONTRACT.role is missing`);
    } else if (!VALID_ROLES.has(contract.role)) {
        errors.push(`${filename}: FRIDA_CONTRACT.role "${contract.role}" not valid`);
    }

    // Validate errorStrategy
    if (!contract.errorStrategy) {
        errors.push(`${filename}: FRIDA_CONTRACT.errorStrategy is missing`);
    } else if (!VALID_ERROR_STRATEGIES.has(contract.errorStrategy)) {
        errors.push(`${filename}: FRIDA_CONTRACT.errorStrategy "${contract.errorStrategy}" not valid`);
    }

    // Validate pure is present
    if (contract.pure === undefined) {
        errors.push(`${filename}: FRIDA_CONTRACT.pure is missing`);
    }

    // Stages and detectors must have input/output
    if (contract.role === 'stage' || contract.role === 'detector') {
        if (!contract.input) {
            errors.push(`${filename}: FRIDA_CONTRACT.input is required for role="${contract.role}"`);
        }
        if (!contract.output) {
            errors.push(`${filename}: FRIDA_CONTRACT.output is required for role="${contract.role}"`);
        }
    }

    // Summary line
    const ioTag = contract.input && contract.output
        ? ` (${contract.input} → ${contract.output})`
        : '';
    console.log(`  ✓ ${filename} — ${contract.role} [${contract.stageId}]${ioTag}`);
}

// ─── Report ─────────────────────────────────────────────────────────────────

console.log(`\n  Checked ${checked} file(s), ${MANDATORY_FILES.length} mandatory`);

if (errors.length > 0) {
    console.error(`\n❌ Pipeline contract check FAILED — ${errors.length} error(s):\n`);
    for (const e of errors) {
        console.error(`  • ${e}`);
    }
    console.error('\nTo fix: add `export const FRIDA_CONTRACT: FridaContract = { ... }` to each file.');
    console.error('See frida-contract.ts for the type definition.\n');
    process.exit(1);
} else {
    console.log('\n✅ Pipeline contract check PASSED — all files declare FRIDA_CONTRACT.\n');
    process.exit(0);
}
