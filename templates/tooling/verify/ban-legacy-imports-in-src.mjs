import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.resolve(__dirname, '../../src');
const BANNED_PATTERNS = [
    '@legacy/',
    'legacy/src/',
    '../legacy/'
];

function checkFiles(dir) {
    const files = fs.readdirSync(dir);
    let hasErrors = false;

    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (checkFiles(fullPath)) {
                hasErrors = true;
            }
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const pattern of BANNED_PATTERNS) {
                if (content.includes(pattern)) {
                    console.error(`Error: Banned pattern "${pattern}" found in ${fullPath}`);
                    hasErrors = true;
                }
            }
        }
    }

    return hasErrors;
}

console.log('Checking for legacy imports in src/**...');
if (checkFiles(SRC_DIR)) {
    console.error('Verification failed: Legacy imports are banned in src/**');
    process.exit(1);
} else {
    console.log('Verification passed: No legacy imports found in src/**');
    process.exit(0);
}
