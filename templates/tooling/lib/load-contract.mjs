import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'yaml';

export function loadModularContract(rootDir) {
    const candidates = [
        join(rootDir, '.frida', 'inbox', 'app-contract', 'contract.index.yaml'),
        join(rootDir, 'contract', 'contract.index.yaml'),
    ];
    const indexAbsPath = candidates.find((candidate) => existsSync(candidate));
    if (!indexAbsPath) {
        throw new Error(`Contract index not found: ${candidates.join(' or ')}`);
    }
    const rawContent = readFileSync(indexAbsPath, 'utf8');
    const indexContent = yaml.parse(rawContent);
    const layers = Array.isArray(indexContent?.layers)
        ? indexContent.layers
        : Array.isArray(indexContent?.contract_index?.layers)
            ? indexContent.contract_index.layers
            : null;

    let contract = {};
    if (layers) {
        for (const layerDef of layers) {
            const layerRelPath = layerDef.file || layerDef.path;
            if (!layerRelPath) continue;

            const layerCandidates = [
                join(rootDir, layerRelPath),
                join(dirname(indexAbsPath), layerRelPath),
            ];
            const layerAbsPath = layerCandidates.find((candidate) => existsSync(candidate));

            if (!layerAbsPath) {
                throw new Error(`Contract layer not found: ${layerCandidates.join(' or ')}`);
            }

            Object.assign(contract, yaml.parse(readFileSync(layerAbsPath, 'utf8')));
        }
    } else {
        contract = indexContent;
    }
    return contract;
}
