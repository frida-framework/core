import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'yaml';

export function loadModularContract(rootDir) {
    const indexAbsPath = join(rootDir, 'contract', 'contract.index.yaml');
    if (!existsSync(indexAbsPath)) {
        throw new Error(`Contract index not found: ${indexAbsPath}`);
    }
    const rawContent = readFileSync(indexAbsPath, 'utf8');
    const indexContent = yaml.parse(rawContent);

    let contract = {};
    if (indexContent?.contract_index && Array.isArray(indexContent.contract_index.layers)) {
        for (const layerDef of indexContent.contract_index.layers) {
            if (layerDef.file || layerDef.path) {
                const layerAbsPath = join(dirname(indexAbsPath), (layerDef.file || layerDef.path));
                if (existsSync(layerAbsPath)) {
                    Object.assign(contract, yaml.parse(readFileSync(layerAbsPath, 'utf8')));
                }
            }
        }
    } else {
        contract = indexContent;
    }
    return contract;
}
