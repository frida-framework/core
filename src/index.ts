export { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
export { runFridaVisualCli } from './visual.ts';
export {
  runFridaCheckCli,
  loadZones,
  resolveZone,
  getExpectedAgentsMd,
  validateZoneAgentsMd,
} from './zone-check.ts';
export { runFridaHashCli } from './template-hash.ts';
export type {
  AdapterGeneratorSpec,
  FridaAdapter,
  FridaCanonSchema,
  FridaExtensionSpec,
  GeneratorSpec,
  SourceSelectorSpec,
  RunFridaCoreOptions,
  MigrationIssue,
} from './types.ts';
export type { Zone, ZoneCandidate, DecisionStep, ValidationResult } from './zone-check.ts';
