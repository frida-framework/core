#!/usr/bin/env node
/**
 * Parameter Surface Check (Concrete B1)
 * 
 * Compares the contract parameter schema (contract:WAYPOINT_SYSTEM_CONTRACT.params.schema)
 * against the actual TypeScript interface in waypoint-config.ts.
 * 
 * Detects:
 *   - Parameters in code but missing from contract (drift: code grew without contract update)
 *   - Parameters in contract but missing from code (drift: contract declared, code removed)
 *   - Trigger priorities mismatch between code and contract
 * 
 * Contract refs:
 *   - contract:WAYPOINT_SYSTEM_CONTRACT.params.schema
 *   - contract:WAYPOINT_SYSTEM_CONTRACT.triggers_priority
 *   - change_control.optimization (schema changes require contract update)
 *
 * Recovery: Update contract params.schema OR waypoint-config.ts to eliminate drift.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModularContract } from '../lib/load-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = join(__filename, '..', '..', '..');

const WAYPOINT_CONFIG = join(ROOT_DIR, 'supabase', 'functions', 'v2-upd-route-details', 'waypoint-config.ts');

// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT PARSER: Extract params.schema from contract:WAYPOINT_SYSTEM_CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

function extractContractSchema(contract) {
    const contractParams = new Set();
    const schema = contract?.WAYPOINT_SYSTEM_CONTRACT?.params?.schema;
    if (!schema) throw new Error('params.schema not found in WAYPOINT_SYSTEM_CONTRACT');

    for (const [group, items] of Object.entries(schema)) {
        if (Array.isArray(items)) {
            for (const item of items) {
                // Remove inline type descriptions e.g. "paramName: Type..."
                const cleanItem = String(item).split(':')[0].trim();
                contractParams.add(`${group}.${cleanItem}`);
            }
        }
    }

    return contractParams;
}

function extractContractTriggers(contract) {
    const triggers = {};
    const priorities = contract?.WAYPOINT_SYSTEM_CONTRACT?.triggers_priority;
    if (!priorities) return triggers;

    for (const [group, items] of Object.entries(priorities)) {
        if (Array.isArray(items)) {
            for (const item of items) {
                if (item.trigger && item.priority !== undefined) {
                    triggers[item.trigger] = item.priority;
                }
            }
        }
    }

    return triggers;
}

// ─────────────────────────────────────────────────────────────────────────────
// CODE PARSER: Extract interface fields from waypoint-config.ts
// ─────────────────────────────────────────────────────────────────────────────

function extractCodeParams(tsContent) {
    const codeParams = new Set();

    // Extract WaypointGenerationParams interface fields (flat + nested groups)
    const wpMatch = tsContent.match(/export interface WaypointGenerationParams\s*\{([\s\S]*?)\n\}/);
    if (!wpMatch) throw new Error('WaypointGenerationParams interface not found');

    const interfaceBody = wpMatch[1];
    parseInterfaceFields(interfaceBody, '', codeParams);

    // Extract SerpentineDetectorParams fields and prefix them
    const spMatch = tsContent.match(/export interface SerpentineDetectorParams\s*\{([\s\S]*?)\n\}/);
    if (spMatch) {
        const spBody = spMatch[1];
        const lines = spBody.split('\n');
        for (const line of lines) {
            const fieldMatch = line.trim().match(/^(\w+)\??:\s/);
            if (fieldMatch) {
                codeParams.add(`serpentineDetector.${fieldMatch[1]}`);
            }
        }
    }

    return codeParams;
}

// Fields to skip entirely — not part of tuning surface
const SKIP_FIELDS = new Set(['serpentineDetector', 'forcedJunctions']);

function parseInterfaceFields(body, prefix, params) {
    const lines = body.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();

        // Skip comments and empty lines
        if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
            i++;
            continue;
        }

        // Nested object field: "fieldName: {" or "fieldName?: Array<{"
        const nestedMatch = line.match(/^(\w+)\??:\s*(?:\{|Array<\{)/);
        if (nestedMatch) {
            const fieldName = nestedMatch[1];
            const groupPrefix = prefix ? `${prefix}.${fieldName}` : fieldName;

            // Skip fields not part of tuning surface
            if (SKIP_FIELDS.has(fieldName)) {
                let depth = 0;
                for (; i < lines.length; i++) {
                    depth += (lines[i].match(/\{/g) || []).length;
                    depth -= (lines[i].match(/\}/g) || []).length;
                    if (depth <= 0) break;
                }
                i++;
                continue;
            }

            // Collect nested block
            let depth = 0;
            let nestedBody = '';
            for (let j = i; j < lines.length; j++) {
                depth += (lines[j].match(/\{/g) || []).length;
                depth -= (lines[j].match(/\}/g) || []).length;
                nestedBody += lines[j] + '\n';
                if (depth <= 0) {
                    i = j + 1;
                    break;
                }
            }

            // Extract leaf fields from nested block — recurse for sub-nested objects
            const nestedLines = nestedBody.split('\n');
            // Parse recursively to handle nested sub-objects like normalize: { ... } inside highwayChange
            let ni = 0;
            while (ni < nestedLines.length) {
                const nl = nestedLines[ni].trim();
                if (!nl || nl.startsWith('//') || nl.startsWith('*')) { ni++; continue; }

                // Sub-nested object: "subField: {"
                const subNestedMatch = nl.match(/^(\w+)\??:\s*\{/);
                if (subNestedMatch && subNestedMatch[1] !== fieldName) {
                    const subName = subNestedMatch[1];
                    let subDepth = 0;
                    for (; ni < nestedLines.length; ni++) {
                        const snl = nestedLines[ni].trim();
                        subDepth += (snl.match(/\{/g) || []).length;
                        subDepth -= (snl.match(/\}/g) || []).length;
                        // Extract leaf fields inside the sub-nested object
                        const subField = snl.match(/^(\w+)\??:\s/);
                        if (subField && subField[1] !== subName) {
                            params.add(`${groupPrefix}.${subName}.${subField[1]}`);
                        }
                        if (subDepth <= 0) break;
                    }
                    ni++;
                    continue;
                }

                // Leaf field
                const fieldLine = nl.match(/^(\w+)\??:\s/);
                if (fieldLine && fieldLine[1] !== fieldName) {
                    params.add(`${groupPrefix}.${fieldLine[1]}`);
                }
                ni++;
            }
            continue;
        }

        // Simple field: "fieldName: type" or "fieldName?: type"
        const simpleMatch = line.match(/^(\w+)\??:\s/);
        if (simpleMatch) {
            const fieldName = simpleMatch[1];
            if (!SKIP_FIELDS.has(fieldName)) {
                const fullPath = prefix ? `${prefix}.${fieldName}` : fieldName;
                params.add(fullPath);
            }
            i++;
            continue;
        }

        i++;
    }
}

function extractCodeTriggers(tsContent) {
    const triggers = {};
    const triggerBlock = tsContent.match(/TRIGGER_PRIORITIES:\s*Record<[^>]+>\s*=\s*\{([\s\S]*?)\};/);
    if (!triggerBlock) return triggers;

    const lines = triggerBlock[1].split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
        const match = trimmed.match(/^(\w+):\s*(\d+)/);
        if (match) {
            triggers[match[1]] = parseInt(match[2], 10);
        }
    }
    return triggers;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPARISON
// ─────────────────────────────────────────────────────────────────────────────

console.log('🔍 Parameter surface check (Concrete B1)...\n');

// Validate files exist
// Load contract
const contract = loadModularContract(ROOT_DIR);
if (!contract) {
    console.error('❌ Failed to load modular contract');
    process.exit(1);
}

if (!existsSync(WAYPOINT_CONFIG)) {
    console.error(`❌ waypoint-config.ts not found: ${WAYPOINT_CONFIG}`);
    process.exit(1);
}

const tsContent = readFileSync(WAYPOINT_CONFIG, 'utf-8');

const errors = [];

// --- Params schema ---
try {
    const contractParams = extractContractSchema(contract);
    const codeParams = extractCodeParams(tsContent);

    // Find params in code but not in contract
    const extraInCode = [...codeParams].filter(p => !contractParams.has(p)).sort();
    // Find params in contract but not in code
    const missingFromCode = [...contractParams].filter(p => !codeParams.has(p)).sort();

    if (extraInCode.length > 0) {
        errors.push({
            kind: 'DRIFT',
            message: 'Parameters in code but NOT in contract params.schema:',
            items: extraInCode,
            action: 'Update contract:WAYPOINT_SYSTEM_CONTRACT.params.schema (optimization task) or remove from code',
        });
    }

    if (missingFromCode.length > 0) {
        errors.push({
            kind: 'DRIFT',
            message: 'Parameters in contract params.schema but NOT in code:',
            items: missingFromCode,
            action: 'Add to waypoint-config.ts or remove from contract schema',
        });
    }

    console.log(`   Params: contract=${contractParams.size}, code=${codeParams.size}`);
} catch (e) {
    errors.push({ kind: 'ERROR', message: `Schema extraction failed: ${e.message}`, items: [], action: 'Fix parser or file format' });
}

// --- Trigger priorities ---
try {
    const contractTriggers = extractContractTriggers(contract);
    const codeTriggers = extractCodeTriggers(tsContent);

    const contractKeys = Object.keys(contractTriggers).sort();
    const codeKeys = Object.keys(codeTriggers).sort();

    const extraTriggers = codeKeys.filter(k => !(k in contractTriggers));
    const missingTriggers = contractKeys.filter(k => !(k in codeTriggers));
    const priorityMismatches = contractKeys.filter(k =>
        k in codeTriggers && contractTriggers[k] !== codeTriggers[k]
    );

    if (extraTriggers.length > 0) {
        errors.push({
            kind: 'DRIFT',
            message: 'Triggers in code but NOT in contract:',
            items: extraTriggers.map(t => `${t}: ${codeTriggers[t]}`),
            action: 'Add to contract:WAYPOINT_SYSTEM_CONTRACT.triggers_priority',
        });
    }

    if (missingTriggers.length > 0) {
        errors.push({
            kind: 'DRIFT',
            message: 'Triggers in contract but NOT in code:',
            items: missingTriggers,
            action: 'Add to TRIGGER_PRIORITIES in waypoint-config.ts',
        });
    }

    if (priorityMismatches.length > 0) {
        errors.push({
            kind: 'DRIFT',
            message: 'Trigger priority mismatches (contract vs code):',
            items: priorityMismatches.map(t => `${t}: contract=${contractTriggers[t]}, code=${codeTriggers[t]}`),
            action: 'Align priorities between contract and code',
        });
    }

    console.log(`   Triggers: contract=${contractKeys.length}, code=${codeKeys.length}`);
} catch (e) {
    errors.push({ kind: 'ERROR', message: `Trigger extraction failed: ${e.message}`, items: [], action: 'Fix parser or file format' });
}

// --- Report ---
if (errors.length > 0) {
    console.error('\n❌ Parameter surface check FAILED — drift detected\n');
    for (const err of errors) {
        console.error(`   ${err.message}`);
        for (const item of err.items) {
            console.error(`     - ${item}`);
        }
        console.error(`   Action: ${err.action}\n`);
    }
    console.error('   Contract: contract:WAYPOINT_SYSTEM_CONTRACT.params.schema');
    console.error('   Code:  supabase/functions/v2-upd-route-details/waypoint-config.ts');
    console.error('   Rule:  change_control.optimization (schema changes require contract update)');
    process.exit(1);
} else {
    console.log('\n✅ Parameter surface matches contract (0 drifts)');
}
