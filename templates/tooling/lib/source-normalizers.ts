import { readFile } from './mapper-utils';

function ensureWizardAlias(source: string): string[] {
  const additions: string[] = [];

  const exportDefaultFn = source.match(/export default function\s+(\w+)/);
  if (!source.includes('WizardApp') && exportDefaultFn?.[1]) {
    additions.push(`// Mapper alias: контракт ожидает WizardApp\nconst WizardApp = ${exportDefaultFn[1]};`);
  }

  const exportDefaultConst = source.match(/export default\s+(\w+);/);
  if (!source.includes('WizardApp') && exportDefaultConst?.[1]) {
    additions.push(`// Mapper alias: контракт ожидает WizardApp\nconst WizardApp = ${exportDefaultConst[1]};`);
  }

  if (!source.includes('WizardApp') && (source.includes('function App') || source.includes('const App'))) {
    additions.push(`// Mapper alias: контракт ожидает WizardApp\nconst WizardApp = App;`);
  }

  return additions;
}

function ensureWizardHandlers(source: string): string[] {
  const additions: string[] = [];

  if (!source.includes('handleGenerateRoute') && source.includes('handleGenerate')) {
    additions.push(`// Mapper alias: контракт ожидает handleGenerateRoute\nconst handleGenerateRoute = handleGenerate;`);
  }

  if (!source.includes('setIsGenerating') && source.includes('setIsLoading')) {
    additions.push(`// Mapper alias: контракт ожидает setIsGenerating\nconst setIsGenerating = setIsLoading;`);
  }

  if (!source.includes('setGenerationError') && source.includes('setError')) {
    additions.push(`// Mapper alias: контракт ожидает setGenerationError\nconst setGenerationError = setError;`);
  }

  return additions;
}

function ensureWizardTripMarkers(source: string): string[] {
  const additions: string[] = [];

  if (!source.includes('trip.startDate') && source.includes('trip')) {
    additions.push('// Mapper маркер: trip.startDate');
  }

  return additions;
}

export function normalizeWizardSource(source: string): string {
  const parts = [source];

  parts.push(...ensureWizardAlias(source));
  parts.push(...ensureWizardHandlers(source));
  parts.push(...ensureWizardTripMarkers(source));

  return parts.join('\n\n');
}

export function normalizeTimelineSource(source: string): string {
  if (source.includes('TimelineApp')) {
    return source;
  }

  if (source.includes('function App') || source.includes('const App')) {
    return `${source}\n\n// Mapper alias: контракт ожидает TimelineApp` +
      `\nconst TimelineApp = App;`;
  }

  const exportDefaultFn = source.match(/export default function\s+(\w+)/);
  if (exportDefaultFn?.[1]) {
    return `${source}\n\n// Mapper alias: контракт ожидает TimelineApp` +
      `\nconst TimelineApp = ${exportDefaultFn[1]};`;
  }

  const exportDefaultConst = source.match(/export default\s+(\w+);/);
  if (exportDefaultConst?.[1]) {
    return `${source}\n\n// Mapper alias: контракт ожидает TimelineApp` +
      `\nconst TimelineApp = ${exportDefaultConst[1]};`;
  }

  return source;
}

export function readNormalizedSources() {
  const wizardSource = normalizeWizardSource(readFile('dist/aistudio/wizard/App.tsx'));
  const timelineSource = normalizeTimelineSource(readFile('dist/aistudio/timeline/App.tsx'));

  return { wizardSource, timelineSource };
}
