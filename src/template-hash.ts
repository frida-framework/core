/**
 * FRIDA Template Hash Utility
 *
 * Computes SHA-256 hashes for all FRIDA_TPL_* template files
 * and compares against values stored in canon.cbmd.yaml.
 *
 * Usage: npm run frida:hash
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import * as yaml from 'yaml';
const ROOT_DIR = path.resolve(process.env.FRIDA_REPO_ROOT || process.cwd());
const CANON_PATH = path.join(ROOT_DIR, 'contract', 'canon.cbmd.yaml');

export function runFridaHashCli(): number {
    console.log('🔑 FRIDA Template Hash Check\n');

    if (!fs.existsSync(CANON_PATH)) {
        console.error('❌ Canon file not found:', CANON_PATH);
        return 1;
    }

    const canonRaw = fs.readFileSync(CANON_PATH, 'utf-8');
    const contract = yaml.parse(canonRaw);

    const tplKeys = Object.keys(contract)
        .filter(k => k.startsWith('FRIDA_TPL_'))
        .sort();

    let ok = 0;
    let mismatch = 0;
    let missing = 0;

    for (const key of tplKeys) {
        const block = contract[key];
        const file = block?.file;
        if (!file) {
            console.warn(`⚠️  ${key}: no 'file' field`);
            missing++;
            continue;
        }

        const filePath = path.join(ROOT_DIR, file);
        if (!fs.existsSync(filePath)) {
            console.error(`❌ ${key}: file missing (${file})`);
            missing++;
            continue;
        }

        const fileBytes = fs.readFileSync(filePath);
        const actualHash = 'sha256:' + crypto.createHash('sha256').update(fileBytes).digest('hex');
        const canonHash = block.content_hash || null;

        if (!canonHash) {
            console.log(`🆕 ${key}: ${actualHash}  (no content_hash in canon)`);
            mismatch++;
        } else if (actualHash === canonHash) {
            console.log(`✅ ${key}: ${actualHash}`);
            ok++;
        } else {
            console.log(`❌ ${key}:`);
            console.log(`   canon:  ${canonHash}`);
            console.log(`   actual: ${actualHash}`);
            mismatch++;
        }

    }

    console.log(`\n━━━ Summary: ${ok} ok, ${mismatch} changed, ${missing} missing ━━━\n`);

    if (mismatch > 0) {
        console.log('📋 Updated hashes for wiki (copy into FRIDA_TPL_* blocks):\n');
        tplKeys.forEach((key, _i) => {
            const block = contract[key];
            if (!block?.file) return;
            const filePath = path.join(ROOT_DIR, block.file);
            if (!fs.existsSync(filePath)) return;
            const fileBytes = fs.readFileSync(filePath);
            const hash = 'sha256:' + crypto.createHash('sha256').update(fileBytes).digest('hex');
            console.log(`# ${key}`);
            console.log(`content_hash: "${hash}"\n`);
        });
    }

    return mismatch > 0 || missing > 0 ? 1 : 0;
}

function main(): void {
    process.exit(runFridaHashCli());
}

const isMainModule = process.argv[1] && (
    process.argv[1].endsWith('template-hash.ts') ||
    process.argv[1].endsWith('template-hash.js')
);

if (isMainModule) {
    main();
}
