export { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
export { runFridaVisualCli } from './visual.ts';
export { runFridaInitCli } from './init.ts';
export { runFridaReportCli } from './report.ts';
export {
  runFridaCheckCli,
  loadZones,
  resolveZone,
  getExpectedAgentsMd,
  validateZoneAgentsMd,
} from './zone-check.ts';
export { runFridaHashCli } from './template-hash.ts';
export { runFridaBuildCli } from './build.ts';
export { loadCanonDocument, resolveCanonPath } from './canon-path.ts';
export type {
  CanonNormalizationResult,
  CanonLayerSpec,
  CanonIndex,
  GeneratorSpec,
  SourceSelectorSpec,
  RunFridaCoreOptions,
  MigrationIssue,
} from './types.ts';
export type { Zone, ZoneCandidate, DecisionStep, ValidationResult } from './zone-check.ts';
