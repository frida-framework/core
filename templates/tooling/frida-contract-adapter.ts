import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { FRIDA_CONTRACT_SCHEMA_REF } from '@sistemado/frida';

interface AdapterOptions {
  rootDir?: string;
  contractPath?: string;
}

type FridaAdapter = {
  id: string;
  schemaRef: string;
  registerGenerators: (registry: any) => void;
  registerSelectors: () => unknown[];
  registerGuards: () => unknown[];
};

interface AdapterConfig {
  boundariesTemplateAbs: string;
  apiReferenceTemplateAbs: string;
}

function getValueByPath(root: Record<string, any>, dottedPath: string): unknown {
  let cursor: any = root;
  for (const part of dottedPath.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function resolveTemplatePath(
  contract: Record<string, any>,
  candidates: string[],
  fallback: string,
): string {
  for (const candidate of candidates) {
    const value = getValueByPath(contract, candidate);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function loadAdapterConfig(rootDir: string, contractPath: string): AdapterConfig {
  const indexAbsPath = path.resolve(rootDir, contractPath);
  let contract: Record<string, any> = {};

  // Read index.yaml if it exists
  if (fs.existsSync(indexAbsPath)) {
    const rawContent = fs.readFileSync(indexAbsPath, 'utf-8');
    const indexContent = yaml.parse(rawContent) as Record<string, any>;

    if (indexContent?.contract_index && Array.isArray(indexContent.contract_index.layers)) {
      for (const layerDef of indexContent.contract_index.layers) {
        if (layerDef.file || layerDef.path) {
          const relativePath = (layerDef.file || layerDef.path);
          // the paths in index are usually relative to the root or the contract directory
          const layerAbsPath = path.resolve(path.dirname(indexAbsPath), relativePath);
          if (fs.existsSync(layerAbsPath)) {
            const layerData = yaml.parse(fs.readFileSync(layerAbsPath, 'utf-8'));
            if (layerData && typeof layerData === 'object') {
              contract = { ...contract, ...layerData };
            }
          } else {
            console.warn(`Layer file not found: ${layerAbsPath}`);
          }
        }
      }
    } else {
      // Fallback if someone passes a monolithic file
      contract = indexContent;
    }
  } else {
    // If even the index file doesn't exist, we just have an empty contract.
    contract = {};
  }

  const boundariesTemplatePath = resolveTemplatePath(
    contract,
    [
      'PATHS.frida.templates.docsGen.boundariesTemplateFile',
      'PATHS.tooling.templates.docsGen.boundariesTemplate',
      'PATHS.tooling.templates.docsGen.boundaries',
    ],
    'scripts/templates/docs-gen/boundaries.hbs',
  );

  const apiReferenceTemplatePath = resolveTemplatePath(
    contract,
    [
      'PATHS.frida.templates.docsGen.apiReferenceTemplateFile',
      'PATHS.tooling.templates.docsGen.apiReferenceTemplate',
      'PATHS.tooling.templates.docsGen.apiReference',
    ],
    'scripts/templates/docs-gen/api-reference.hbs',
  );

  return {
    boundariesTemplateAbs: path.resolve(rootDir, boundariesTemplatePath),
    apiReferenceTemplateAbs: path.resolve(rootDir, apiReferenceTemplatePath),
  };
}

export function createContractDrivenAdapter(options: AdapterOptions = {}): FridaAdapter {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const contractPath = options.contractPath || '.frida/inbox/app-contract/contract.index.yaml';
  const config = loadAdapterConfig(rootDir, contractPath);

  return {
    id: 'contract-driven-host',
    schemaRef: FRIDA_CONTRACT_SCHEMA_REF,
    registerGenerators(registry) {
      registry.register({
        id: 'contract.docs.boundaries',
        deterministic: true,
        inputs: ['ZONES', 'FRIDA_GUARDS_BASELINE', 'PROJECT_GUARDS', 'GUARDS'],
        outputs: ['docs/policy/BOUNDARIES.md'],
        run(context) {
          const template = context.utils.loadTemplate(
            path.dirname(config.boundariesTemplateAbs),
            path.basename(config.boundariesTemplateAbs),
          );
          const enforcedGuards = context.effectiveGuards.guards.filter((guard: any) => guard.enforcement);
          context.utils.write(
            path.join(context.runtimePaths.docsPolicyDir, 'BOUNDARIES.md'),
            template({ zones: context.zones, enforcedGuards }),
            true,
          );
        },
      });

      registry.register({
        id: 'contract.docs.api-reference',
        deterministic: true,
        inputs: ['FUNCTIONS_REGISTRY'],
        outputs: ['docs/reference/API_REFERENCE.md'],
        run(context) {
          const edgeFunctions = context.contract['FUNCTIONS_REGISTRY']?.edge_functions;
          if (!edgeFunctions || typeof edgeFunctions !== 'object' || Object.keys(edgeFunctions).length === 0) {
            return;
          }

          const normalizedFunctions = Object.entries(edgeFunctions).map(([name, data]: [string, any]) => {
            const functionPath =
              context.utils.resolveRefValue(context.contract, data.path, `FUNCTIONS_REGISTRY.edge_functions.${name}.path`) ||
              context.utils.resolveRefValue(context.contract, data.dirRef, `FUNCTIONS_REGISTRY.edge_functions.${name}.dirRef`) ||
              context.utils.resolveRefValue(context.contract, data.pathDirRef, `FUNCTIONS_REGISTRY.edge_functions.${name}.pathDirRef`) ||
              '';

            const functionEntry =
              context.utils.resolveRefValue(context.contract, data.entry, `FUNCTIONS_REGISTRY.edge_functions.${name}.entry`) ||
              context.utils.resolveRefValue(context.contract, data.entryFileRef, `FUNCTIONS_REGISTRY.edge_functions.${name}.entryFileRef`) ||
              '';

            return {
              name,
              path: functionPath,
              entry: functionEntry,
              purpose: data.purpose || '',
            };
          });

          const template = context.utils.loadTemplate(
            path.dirname(config.apiReferenceTemplateAbs),
            path.basename(config.apiReferenceTemplateAbs),
          );
          context.utils.write(
            path.join(context.runtimePaths.docsReferenceDir, 'API_REFERENCE.md'),
            template({
              edgeFunctions: normalizedFunctions,
              notes: context.contract['FUNCTIONS_REGISTRY']?.notes || [],
            }),
            true,
          );
        },
      });
    },
    registerSelectors() {
      return [];
    },
    registerGuards() {
      return [];
    },
  };
}
