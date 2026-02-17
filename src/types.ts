import type { AdapterGenerationContext } from './legacy-generator.ts';

export interface FridaCanonSchema {
  meta: {
    schemaVersion: string;
    mode: 'schema';
    canonArtifactRef?: string;
    [key: string]: unknown;
  };
  core: {
    canonicalSourceBlocks: string[];
    selectorGrammar: 'jsonpath-lite';
    generatorPipelineContracts: string[];
    pathRefs: Record<string, string>;
    outputContracts: string[];
    [key: string]: unknown;
  };
  extensions?: FridaExtensionSpec[];
  [key: string]: unknown;
}

export interface FridaExtensionSpec {
  id: string;
  schemaRef?: string;
  sourceSelectors: SourceSelectorSpec[];
  generatorBindings?: string[];
  outputTargets?: string[];
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
  canon: Record<string, any>;
  schemaModel: FridaCanonSchema;
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

export interface FridaAdapter {
  id: string;
  schemaRef?: string;
  registerGenerators: (registry: AdapterGeneratorRegistry) => void;
  registerSelectors?: () => SourceSelectorSpec[];
  registerGuards?: () => unknown[];
}

export interface AdapterGeneratorSpec {
  id: string;
  inputs?: string[];
  outputs?: string[];
  deterministic?: boolean;
  run: (context: AdapterGenerationContext) => Promise<void> | void;
}

export interface AdapterGeneratorRegistry {
  register: (spec: AdapterGeneratorSpec) => void;
}

export interface CanonNormalizationResult {
  model: FridaCanonSchema;
  telemetry: GenerationTelemetry;
}

export interface RunFridaCoreOptions {
  rootDir?: string;
  canonPath?: string;
  adapters?: FridaAdapter[];
  strictSchema?: boolean;
}

export interface MigrationIssue {
  field: string;
  replacement: string;
  severity: 'warning' | 'error';
  message: string;
}
