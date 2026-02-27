/**
 * Redirect Resolver
 * 
 * Resolves constraint violations to actionable redirects.
 * When an agent attempts forbidden action, provides alternative path.
 */

export interface RedirectRule {
  from: string;              // Pattern to match (supports globs)
  to: string;                // Redirect target (can contain ${variables})
  reason: string;            // Why this redirect exists
  guide?: string;            // Documentation path
  pattern?: {                // Pattern-based redirect
    from: string;            // e.g., "src/components/${filename}.tsx"
    to: string;              // e.g., "scripts/mapper/surgeon-${component}.ts"
  };
}

export interface RedirectResult {
  redirected: boolean;
  targetPath?: string;
  reason?: string;
  guide?: string;
  command?: string;
}

export class RedirectResolver {
  private rules: RedirectRule[] = [];

  constructor(rules?: RedirectRule[]) {
    if (rules) {
      this.rules = rules;
    }
  }

  /**
   * Add a redirect rule
   */
  addRule(rule: RedirectRule): void {
    this.rules.push(rule);
  }

  /**
   * Load redirect rules from profile security block
   */
  loadFromSecurity(security: any): void {
    if (!security.redirect) return;

    if (Array.isArray(security.redirect)) {
      this.rules.push(...security.redirect);
    } else {
      // Single redirect object with multiple path mappings
      for (const [from, config] of Object.entries(security.redirect)) {
        if (typeof config === 'string') {
          this.rules.push({
            from,
            to: config,
            reason: 'Path forbidden by profile',
          });
        } else if (typeof config === 'object') {
          this.rules.push({
            from,
            ...(config as any),
          });
        }
      }
    }
  }

  /**
   * Resolve a path to its redirect target
   */
  resolve(attemptedPath: string): RedirectResult {
    for (const rule of this.rules) {
      if (this.pathMatches(attemptedPath, rule.from)) {
        // Pattern-based redirect
        if (rule.pattern) {
          const targetPath = this.applyPattern(attemptedPath, rule.pattern);
          if (targetPath) {
            return {
              redirected: true,
              targetPath,
              reason: rule.reason,
              guide: rule.guide,
              command: this.inferCommand(targetPath),
            };
          }
        }

        // Simple redirect
        return {
          redirected: true,
          targetPath: rule.to,
          reason: rule.reason,
          guide: rule.guide,
          command: this.inferCommand(rule.to),
        };
      }
    }

    // No redirect found
    return { redirected: false };
  }

  /**
   * Check if path matches pattern (supports globs)
   */
  private pathMatches(path: string, pattern: string): boolean {
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

    return false;
  }

  /**
   * Apply pattern-based redirect
   */
  private applyPattern(path: string, pattern: { from: string; to: string }): string | null {
    // Extract variables from path using pattern
    const variables = this.extractVariables(path, pattern.from);
    if (!variables) return null;

    // Apply variables to target pattern
    let result = pattern.to;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(`\${${key}}`, value);
    }

    return result;
  }

  /**
   * Extract variables from path using pattern
   */
  private extractVariables(path: string, pattern: string): Record<string, string> | null {
    // Simple implementation for ${var} style patterns
    const regex = pattern
      .replace(/\//g, '\\/')
      .replace(/\$\{(\w+)\}/g, '(?<$1>[^/]+)');

    const match = path.match(new RegExp(`^${regex}$`));
    if (!match || !match.groups) return null;

    return match.groups;
  }

  /**
   * Infer command to run based on target path
   */
  private inferCommand(targetPath: string): string | undefined {
    if (targetPath.includes('scripts/mapper/')) {
      return 'npm run mapper:all';
    }
    if (targetPath.includes('contract/')) {
      return 'npm run frida:gen';
    }
    return undefined;
  }

  /**
   * Get all redirect rules
   */
  getRules(): RedirectRule[] {
    return [...this.rules];
  }
}

/**
 * Default redirect rules for kaTai project
 */
export const DEFAULT_REDIRECT_RULES: RedirectRule[] = [
  {
    from: 'src/components/**',
    to: 'scripts/mapper/surgeon-wizard.ts',
    reason: 'UI components are generated from AI Studio',
    guide: 'docs/mapper/wizard-integration.md',
    pattern: {
      from: 'src/components/${filename}.tsx',
      to: 'scripts/mapper/surgeon-${component}.ts',
    },
  },
  {
    from: 'dist/aistudio/**',
    to: 'contract/contract.index.yaml',
    reason: 'AI Studio artifacts are managed externally',
    guide: 'docs/aistudio/sync.md',
  },
  {
    from: 'src/services/*/types.ts',
    to: 'src/services/v2/contracts/',
    reason: 'Types should be defined in contracts',
    guide: 'docs/contracts/types.md',
  },
];
