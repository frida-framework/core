export { runFridaGeneration, runFridaMigrationReport } from './runtime.ts';
export { runFridaVisualCli } from './visual.ts';
export { runFridaVisualViewerCli } from './visualizer-dispatch.ts';
export { runFridaInitCli } from './init.ts';
export { runFridaBootstrapCli } from './bootstrap.ts';
export { runFridaReportCli } from './report.ts';
export { checkAgentsContractSet, runFridaAgentsContractSetCheck } from './agents-contract-set.ts';
export {
  runFridaCheckCli,
  loadZones,
  resolveZone,
  getExpectedAgentsMd,
  validateZoneAgentsMd,
} from './zone-check.ts';
export { runFridaHashCli } from './template-hash.ts';
export { runFridaBuildCli } from './build.ts';
export { loadContractDocument, resolveContractPath } from './contract-path.ts';
export type {
  ContractNormalizationResult,
  ContractLayerSpec,
  ContractIndex,
  GeneratorSpec,
  SourceSelectorSpec,
  RunFridaCoreOptions,
  MigrationIssue,
} from './types.ts';
export type {
  VisualOverlayV1,
  ProjectionUnitRecord,
  ComponentBoundaryRecord,
  OverlayNodeRecord,
  OverlayEdgeRecord,
  EntryPointRecord,
  ExitPointRecord,
  MountedChildRelationRecord,
  BoundaryMappingRecord,
  DependencyEdgeRecord,
  ContextShellHintRecord,
  TraceProjectionHintRecord,
} from './visual.ts';
export type { Zone, ZoneCandidate, DecisionStep, ValidationResult } from './zone-check.ts';
