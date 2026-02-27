// Mapper Contract - Machine-checkable definitions
// This file defines the contract that generated output must satisfy

export interface MapperPaths {
  // Source roots (read-only)
  readonly sources: {
    readonly wizard: string;
    readonly timeline: string;
    readonly style: string;
  };
  
  // Generated output roots (overwritten)
  readonly outputs: {
    readonly wizard: string;
    readonly timeline: string;
  };
}

export interface ForbiddenPatterns {
  // Mock/test data constants
  readonly mockConstants: readonly string[];
  
  // Forbidden imports (wizard)
  readonly wizardImports: readonly string[];
  
  // Forbidden state variables (wizard)
  readonly wizardState: readonly string[];
  
  // Forbidden imports (timeline)
  readonly timelineImports: readonly string[];
  
  // Forbidden state/handlers (timeline)
  readonly timelineState: readonly string[];
  
  // Forbidden UI elements (timeline)
  readonly timelineUI: readonly string[];
}

export interface RequiredExports {
  // Wizard component requirements
  readonly wizard: {
    readonly componentName: string;
    readonly props: readonly string[];
    readonly functions: readonly string[];
  };
  
  // Timeline component requirements
  readonly timeline: {
    readonly componentName: string;
    readonly props: readonly string[];
    readonly state: readonly string[];
  };
}

export interface MapperContract {
  readonly paths: MapperPaths;
  readonly forbidden: ForbiddenPatterns;
  readonly required: RequiredExports;
}

// Contract instance
export const MAPPER_CONTRACT: MapperContract = {
  paths: {
    sources: {
      wizard: '/dist/aistudio/wizard/',
      timeline: '/dist/aistudio/timeline/',
      style: '/dist/aistudio/style/',
    },
    outputs: {
      wizard: '/src/mount/wizard/',
      timeline: '/src/mount/timeline/',
    },
  },
  forbidden: {
    mockConstants: [
      'INITIAL_POINTS',
      'INITIAL_SEGMENTS',
      'const MOCK_',
      'const DEMO_',
    ],
    wizardImports: [
      "import { generateRoute } from './services/geminiService';",
    ],
    wizardState: [
      'routeData',
      'setRouteData',
    ],
    timelineImports: [
      "import { calculateSegmentDetails } from './services/geminiService';",
    ],
    timelineState: [
      'handleCalculateSegment',
      'isCalculating',
    ],
    timelineUI: [
      'Search card',
      'point controls',
      'segment controls',
      'photos',
    ],
  },
  required: {
    wizard: {
      componentName: 'WizardApp',
      props: ['onComplete', 'onError'],
      functions: ['handleGenerateRoute', 'setIsGenerating', 'setGenerationError'],
    },
    timeline: {
      componentName: 'TimelineApp',
      props: ['routeId', 'onSave', 'onShare', 'onReset'],
      state: ['searchQuery'],
    },
  },
};

// Helper functions for validation
export function getForbiddenPatterns(): string[] {
  return [
    ...MAPPER_CONTRACT.forbidden.mockConstants,
    ...MAPPER_CONTRACT.forbidden.wizardImports,
    ...MAPPER_CONTRACT.forbidden.wizardState,
    ...MAPPER_CONTRACT.forbidden.timelineImports,
    ...MAPPER_CONTRACT.forbidden.timelineState,
  ];
}

export function getOutputPaths(): string[] {
  return [
    MAPPER_CONTRACT.paths.outputs.wizard,
    MAPPER_CONTRACT.paths.outputs.timeline,
  ];
}
