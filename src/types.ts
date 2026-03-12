

export interface FridaContractSchema {
  meta: {
    schemaVersion: string;
    mode: 'schema';
    contractArtifactRef?: string;
    [key: string]: unknown;
  };
  core: {
    contracticalSourceBlocks: string[];
    selectorGrammar: 'jsonpath-lite';
    generatorPipelineContracts: string[];
    pathRefs: Record<string, string>;
    outputContracts: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SourceSelectorSpec {
  id: string;
  selector: string;
  required?: boolean;
  description?: string;
}

export interface SelectorMatch {
  selectorId: string;
  selector: string;
  path: string;
  value: unknown;
}

export interface ResolvedSelectorResult {
  spec: SourceSelectorSpec;
  matches: SelectorMatch[];
}

export interface ResolvedSourceMap {
  byId: Map<string, ResolvedSelectorResult>;
  ordered: ResolvedSelectorResult[];
}

export interface GenerationTelemetry {
  deprecatedFieldCount: number;
  deprecatedFields: string[];
  warnings: string[];
}

export interface GeneratorContext {
  rootDir: string;
  contract: Record<string, any>;
  schemaModel: FridaContractSchema;
  sources: ResolvedSourceMap;
  telemetry: GenerationTelemetry;
}

export interface GeneratorSpec {
  id: string;
  inputs?: string[];
  outputs?: string[];
  deterministic?: boolean;
  run: (context: GeneratorContext) => Promise<void> | void;
}

export interface ContractNormalizationResult {
  model: FridaContractSchema;
  telemetry: GenerationTelemetry;
}

export interface RunFridaCoreOptions {
  rootDir?: string;
  contractPath?: string;
  strictSchema?: boolean;
}

export interface MigrationIssue {
  field: string;
  replacement: string;
  severity: 'warning' | 'error';
  message: string;
}

export interface ContractValidationIssue {
  code: string;
  message: string;
  location?: string;
  suggestion?: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationIssue[];
  warnings: ContractValidationIssue[];
}

export type BlockVisibility = 'public' | 'private';

export interface ContractLayerSpec {
  id: string;
  path: string;
  visibility: BlockVisibility | 'mixed';
  blocks: string[];
}

export interface ContractIndex {
  schema_version?: string;
  contract_id?: string;
  version?: string;
  layers?: ContractLayerSpec[];
  contract_index?: {
    version: string;
    schema: string;
    assembled_schema?: string;
    monolith_fallback?: string;
    layers: ContractLayerSpec[];
  };
}
