import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yaml from 'yaml';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneNode(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneNode(item));
    }
    if (isPlainObject(value)) {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = cloneNode(item);
        }
        return out;
    }
    return value;
}

function mergeUniqueArrays(base, incoming) {
    const result = base.map((item) => cloneNode(item));
    const seen = new Set(result.map((item) => JSON.stringify(item)));
    for (const item of incoming) {
        const signature = JSON.stringify(item);
        if (seen.has(signature)) continue;
        result.push(cloneNode(item));
        seen.add(signature);
    }
    return result;
}

function mergeExtensionContribution(base, incoming, mergePath) {
    if (base === undefined) {
        return cloneNode(incoming);
    }
    if (Array.isArray(base) && Array.isArray(incoming)) {
        return mergeUniqueArrays(base, incoming);
    }
    if (isPlainObject(base) && isPlainObject(incoming)) {
        const result = cloneNode(base);
        for (const [key, value] of Object.entries(incoming)) {
            result[key] = mergeExtensionContribution(result[key], value, `${mergePath}.${key}`);
        }
        return result;
    }
    if (base === incoming) {
        return base;
    }
    throw new Error(`App extension contribution conflict at ${mergePath}`);
}

function composeAppExtensions(contract) {
    const extensionEntries = Object.entries(contract).filter(
        ([key, value]) => key.startsWith('APP_EXTENSION_') && isPlainObject(value),
    );

    if (extensionEntries.length === 0) {
        return contract;
    }

    const activeExtensionIds = new Set();
    for (const [blockKey, blockValue] of extensionEntries) {
        const id = blockValue.id;
        if (typeof id !== 'string' || !id.trim()) {
            throw new Error(`App extension block ${blockKey} is missing a non-empty id`);
        }
        if (activeExtensionIds.has(id)) {
            throw new Error(`Duplicate active app extension id detected: ${id}`);
        }
        activeExtensionIds.add(id);
    }

    for (const [blockKey, blockValue] of extensionEntries) {
        const requires = Array.isArray(blockValue.requires) ? blockValue.requires : [];
        for (const requiredExtensionId of requires) {
            if (!activeExtensionIds.has(requiredExtensionId)) {
                throw new Error(
                    `App extension block ${blockKey} requires missing active extension "${requiredExtensionId}". Activate the parent extension layer first.`,
                );
            }
        }
    }

    const composed = cloneNode(contract);
    for (const [blockKey, blockValue] of extensionEntries) {
        const contributes = blockValue.contributes;
        if (!isPlainObject(contributes)) continue;
        for (const [targetBlock, contribution] of Object.entries(contributes)) {
            composed[targetBlock] = mergeExtensionContribution(
                composed[targetBlock],
                contribution,
                `${blockKey}.contributes.${targetBlock}`,
            );
        }
    }

    return composed;
}

export function loadModularContract(rootDir) {
    const candidates = [
        join(rootDir, '.frida', 'inbox', 'app-contract', 'contract.index.yaml'),
        join(rootDir, 'core-contract', 'contract.index.yaml'),
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
    return composeAppExtensions(contract);
}
