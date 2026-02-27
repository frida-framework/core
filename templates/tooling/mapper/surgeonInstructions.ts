/**
 * SURGERY_INSTRUCTIONS - Defines transformation rules for wizard and timeline
 * Used by surgeon-wizard.ts and surgeon-timeline.ts
 */

export const SURGERY_INSTRUCTIONS = {
  wizard: {
    stripWizardStyles: {
      removeImports: [
        { find: /import '\.\/index\.css';\n?/g },
        { find: /import '\.\/styles\.css';\n?/g },
      ],
      note: 'Styles loaded globally via src/index.css',
      styleImport: {
        source: 'dist/aistudio/wizard/index.css',
        statement: "// Styles loaded globally via src/index.css",
      },
    },

    replaceStyleClasses: {
      mappings: [
        // These mappings are applied after tailwind → moto conversions
        { find: /bg-moto-brand/g, replace: 'bg-[#E87703]' },
        { find: /bg-moto-brand-hover/g, replace: 'bg-[#D06903]' },
        { find: /text-moto-brand/g, replace: 'text-[#E87703]' },
        { find: /text-moto-brand-hover/g, replace: 'text-[#D06903]' },
        { find: /border-moto-brand/g, replace: 'border-[#E87703]' },
        { find: /ring-moto-brand/g, replace: 'ring-[#E87703]' },
        { find: /shadow-moto-brand/g, replace: 'shadow-[#E87703]' },
        { find: /bg-moto-surface/g, replace: 'bg-slate-900/40' },
        { find: /bg-moto-inset/g, replace: 'bg-slate-800/40' },
        { find: /bg-moto-base/g, replace: 'bg-slate-900' },
        { find: /text-moto-text/g, replace: 'text-slate-200' },
        { find: /text-moto-text-sec/g, replace: 'text-slate-300' },
        { find: /text-moto-muted/g, replace: 'text-slate-500' },
        { find: /border-moto-inset/g, replace: 'border-slate-700' },
        { find: /ring-moto-inset/g, replace: 'ring-slate-700' },
      ],
    },

    remove: {
      imports: [
        { find: /import \{ generateRoute \} from '\.\/services\/geminiService';\n?/g },
      ],
    },

    replace: {
      stateRenames: [
        { find: /const \[isLoading, setIsLoading\]/g, replace: 'const [isGenerating, setIsGenerating]' },
        { find: /const \[error, setError\]/g, replace: 'const [generationError, setGenerationError]' },
        { find: /const \[result, setResult\]/g, replace: '// result state removed - wizard navigates to route page' },
        { find: /isLoading/g, replace: 'isGenerating' },
        { find: /setIsLoading/g, replace: 'setIsGenerating' },
        { find: /setError\(/g, replace: 'setGenerationError(' },
        { find: /setResult\([^)]*\);?\n?/g, replace: '// setResult removed\n' },
      ],
    },

    removeResultDisplay: {
      elements: [
        // Remove the result view block (result ? (...) : (...))
        { find: /: result \? \(\s*\/\/ Result View[\s\S]*?<\/div>\s*\) : \(/g, replace: ': (' },
      ],
    },

    addProps: {
      interface: `interface WizardAppProps {
  onComplete?: (routeId: string) => void;
  onError?: (error: Error) => void;
}`,
    },
  },

  timeline: {
    remove: {
      imports: [
        { find: /import \{ calculateSegmentDetails \} from '\.\/services\/geminiService';\n?/g },
      ],
      functions: [
        { find: /const handleCalculateSegment = async[\s\S]*?catch[\s\S]*?\};/g },
      ],
      state: [
        { find: /const \[isCalculating, setIsCalculating\] = useState\([^)]*\);\n?/g },
      ],
    },

    remove_search: {
      elements: [
        // Remove search card UI
        { find: /\{\/\* Search Card \*\/\}[\s\S]*?<\/div>\s*\n/g },
      ],
    },

    remove_pointControls: {
      elements: [
        // Remove point controls
        { find: /\{\/\* Point Controls \*\/\}[\s\S]*?<\/div>\s*\n/g },
      ],
    },

    remove_segmentControls: {
      elements: [
        // Remove segment controls
        { find: /\{\/\* Segment Controls \*\/\}[\s\S]*?<\/div>\s*\n/g },
      ],
    },

    remove_aiButton: {
      elements: [
        // Remove AI calculate button that uses handleCalculateSegment
        { find: /\{\/\* AI Action[^*]*\*\/\}\s*<button[\s\S]*?handleCalculateSegment[\s\S]*?<\/button>/g },
      ],
    },

    remove_photos: {
      elements: [
        // Remove photos section
        { find: /\{\/\* Photos \*\/\}[\s\S]*?<\/div>\s*\n/g },
      ],
    },

    addProps: {
      interface: `interface TimelineAppProps {
  routeId: string;
  onSave?: () => Promise<{ token: string }>;
  onShare?: (token: string) => void;
  onReset?: () => void;
}`,
    },
  },
};
