/**
 * Path Normalization Library
 * 
 * Handles contract paths, aliases, and deprecated paths from contract.
 * Ensures all path references resolve to single contract form.
 */

export interface PathMapping {
  contract: string;
  aliases?: string[];
  deprecated?: string[];
}

export interface NormalizeResult {
  contract: string;
  deprecated: boolean;
  matched: 'exact' | 'alias' | 'deprecated';
}

export class PathNormalizer {
  private mappings: Map<string, PathMapping> = new Map();

  constructor(pathsBlock?: Record<string, any>) {
    if (pathsBlock) {
      this.loadFromContract(pathsBlock);
    }
  }

  /**
   * Load path mappings from contract PATHS block
   */
  private loadFromContract(pathsBlock: Record<string, any>): void {
    for (const [key, value] of Object.entries(pathsBlock)) {
      if (typeof value === 'string') {
        // Simple mapping: key -> value
        this.mappings.set(key, { contract: value });
      } else if (typeof value === 'object' && value.contract) {
        // Complex mapping with aliases
        this.mappings.set(key, value as PathMapping);
      }
    }
  }

  /**
   * Normalize a path to its contract form
   */
  normalize(inputPath: string): NormalizeResult {
    // Strip leading ./ or /
    const cleaned = inputPath.replace(/^\.\//, '').replace(/^\//, '');

    // Check all mappings
    for (const [_key, mapping] of this.mappings) {
      // Exact match on contract
      if (this.pathsMatch(cleaned, mapping.contract)) {
        return {
          contract: mapping.contract,
          deprecated: false,
          matched: 'exact',
        };
      }

      // Check aliases
      if (mapping.aliases) {
        for (const alias of mapping.aliases) {
          if (this.pathsMatch(cleaned, alias)) {
            return {
              contract: mapping.contract,
              deprecated: false,
              matched: 'alias',
            };
          }
        }
      }

      // Check deprecated
      if (mapping.deprecated) {
        for (const deprecatedPath of mapping.deprecated) {
          if (this.pathsMatch(cleaned, deprecatedPath)) {
            return {
              contract: mapping.contract,
              deprecated: true,
              matched: 'deprecated',
            };
          }
        }
      }
    }

    // No mapping found, return as-is
    return {
      contract: cleaned,
      deprecated: false,
      matched: 'exact',
    };
  }

  /**
   * Check if two paths match (supporting globs)
   */
  private pathsMatch(path: string, pattern: string): boolean {
    // Exact match
    if (path === pattern) return true;

    // Glob match
    if (pattern.includes('*')) {
      const regex = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\//g, '\\/');
      return new RegExp(`^${regex}$`).test(path);
    }

    // Prefix match for directories
    if (pattern.endsWith('/')) {
      return path.startsWith(pattern);
    }

    return false;
  }

  /**
   * Add a runtime mapping (for dynamic paths)
   */
  addMapping(key: string, mapping: PathMapping): void {
    this.mappings.set(key, mapping);
  }

  /**
   * Get all contract paths
   */
  getContractPaths(): string[] {
    return Array.from(this.mappings.values()).map(m => m.contract);
  }

  /**
   * Check if a path is deprecated
   */
  isDeprecated(path: string): boolean {
    const result = this.normalize(path);
    return result.deprecated;
  }

  /**
   * Get suggestion for deprecated path
   */
  getSuggestion(deprecatedPath: string): string | null {
    const result = this.normalize(deprecatedPath);
    if (result.deprecated && result.contract !== deprecatedPath) {
      return result.contract;
    }
    return null;
  }
}

/**
 * Common path normalizations for kaTai project
 */
export const DEFAULT_PATH_MAPPINGS: Record<string, PathMapping> = {
  service_layer: {
    contract: 'src/services/**',
    aliases: ['services/**', './src/services/**'],
    deprecated: ['src/backend/**', 'src/api/**'],
  },
  components: {
    contract: 'src/components/**',
    aliases: ['components/**', './src/components/**'],
  },
  mapper: {
    contract: 'scripts/mapper/**',
    aliases: ['mapper/**', './scripts/mapper/**'],
  },
  aistudio: {
    contract: 'dist/aistudio/**',
    aliases: ['aistudio/**', './dist/aistudio/**'],
  },
  edge_functions: {
    contract: 'supabase/functions/**',
    aliases: ['functions/**', './supabase/functions/**'],
  },
};
