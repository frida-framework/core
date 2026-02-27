import fs from 'fs';
import path from 'path';
import { loadModularContract } from './lib/load-contract.mjs';

const ROOT_DIR = path.resolve(process.cwd());

try {
    console.log(`Reading modular contract...`);
    const parsed = loadModularContract(ROOT_DIR) as Record<string, any>;

    let count = 0;
    for (const key of Object.keys(parsed)) {
        if (key.startsWith('FRIDA_TPL_')) {
            const tpl = parsed[key];
            if (tpl && tpl.content && tpl.file) {
                const targetPath = tpl.file;
                const content = tpl.content;

                // Ensure directory exists
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(targetPath, content);
                console.log(`Synced ${key} -> ${targetPath}`);
                count++;
            }
        }
    }

    if (count === 0) {
        console.log('No FRIDA_TPL_* blocks found with content/file to sync.');
    } else {
        console.log(`Successfully synced ${count} templates.`);
    }

} catch (error) {
    console.error('Error syncing templates:', error);
    process.exit(1);
}
