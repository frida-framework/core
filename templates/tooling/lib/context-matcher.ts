/**
 * Context Matcher
 * 
 * Determines which context should be active based on task keywords and description.
 * Enables profiles to have different permissions based on task type.
 */

export interface ProfileContext {
  id: string;
  trigger: string | string[];  // Keywords or conditions that trigger this context
  additional_read?: string[];  // Additional read permissions
  additional_edit?: string[];  // Additional edit permissions
  reason: string;              // Why this context exists
}

export interface ContextMatchResult {
  matched: boolean;
  contextId?: string;
  context?: ProfileContext;
  confidence: number;          // 0-1, how confident the match is
}

export class ContextMatcher {
  /**
   * Match a task description against available contexts
   */
  static match(
    taskDescription: string,
    keywords: string[],
    availableContexts: Record<string, ProfileContext>
  ): ContextMatchResult {
    const taskLower = taskDescription.toLowerCase();
    const keywordsLower = keywords.map(k => k.toLowerCase());

    let bestMatch: ContextMatchResult = {
      matched: false,
      confidence: 0,
    };

    for (const [contextId, context] of Object.entries(availableContexts)) {
      const result = this.matchSingle(taskLower, keywordsLower, context);
      if (result.confidence > bestMatch.confidence) {
        bestMatch = {
          matched: true,
          contextId,
          context,
          confidence: result.confidence,
        };
      }
    }

    // Only return match if confidence > 0.5
    if (bestMatch.confidence > 0.5) {
      return bestMatch;
    }

    return { matched: false, confidence: 0 };
  }

  /**
   * Match against a single context
   */
  private static matchSingle(
    taskLower: string,
    keywordsLower: string[],
    context: ProfileContext
  ): { confidence: number } {
    const triggers = Array.isArray(context.trigger) ? context.trigger : [context.trigger];
    let score = 0;
    const maxScore = triggers.length;

    for (const trigger of triggers) {
      const triggerLower = trigger.toLowerCase();

      // Check exact match in keywords
      if (keywordsLower.includes(triggerLower)) {
        score += 1.5; // Higher weight for keyword match
      }

      // Check presence in task description
      if (taskLower.includes(triggerLower)) {
        score += 1;
      }

      // Check for compound triggers (e.g., "keyword1 AND keyword2")
      if (trigger.includes(' AND ')) {
        const parts = trigger.toLowerCase().split(' and ').map(p => p.trim());
        if (parts.every(p => taskLower.includes(p) || keywordsLower.includes(p))) {
          score += 2; // High weight for compound match
        }
      }

      // Check for OR triggers (e.g., "keyword1 OR keyword2")
      if (trigger.includes(' OR ')) {
        const parts = trigger.toLowerCase().split(' or ').map(p => p.trim());
        if (parts.some(p => taskLower.includes(p) || keywordsLower.includes(p))) {
          score += 0.5; // Lower weight for OR match
        }
      }
    }

    const confidence = Math.min(score / maxScore, 1.0);
    return { confidence };
  }

  /**
   * Evaluate a boolean trigger expression
   */
  static evaluateTrigger(
    trigger: string,
    task: string,
    keywords: string[]
  ): boolean {
    const taskLower = task.toLowerCase();
    const keywordsLower = keywords.map(k => k.toLowerCase());

    // Handle AND
    if (trigger.includes(' AND ')) {
      const parts = trigger.split(' AND ').map(p => p.trim().toLowerCase());
      return parts.every(p => taskLower.includes(p) || keywordsLower.includes(p));
    }

    // Handle OR
    if (trigger.includes(' OR ')) {
      const parts = trigger.split(' OR ').map(p => p.trim().toLowerCase());
      return parts.some(p => taskLower.includes(p) || keywordsLower.includes(p));
    }

    // Simple keyword match
    const triggerLower = trigger.toLowerCase();
    return taskLower.includes(triggerLower) || keywordsLower.includes(triggerLower);
  }

  /**
   * Merge base permissions with context permissions
   */
  static mergePermissions(
    base: { read_allow: string[]; edit_allow: string[] },
    context: ProfileContext
  ): { read_allow: string[]; edit_allow: string[] } {
    return {
      read_allow: [
        ...base.read_allow,
        ...(context.additional_read || []),
      ],
      edit_allow: [
        ...base.edit_allow,
        ...(context.additional_edit || []),
      ],
    };
  }
}

/**
 * Default contexts for kaTai profiles
 */
export const DEFAULT_CONTEXTS: Record<string, ProfileContext> = {
  integration: {
    id: 'integration',
    trigger: 'integrate OR integration OR connect',
    additional_read: [
      'src/services/*/types.ts',
      'src/services/*/contracts/**',
      'src/lib/types/**',
    ],
    reason: 'Integration tasks require reading service contracts and types',
  },

  refactoring: {
    id: 'refactoring',
    trigger: 'refactor OR restructure OR reorganize',
    additional_edit: [
      'scripts/mapper/**',
      'src/lib/**',
    ],
    reason: 'Refactoring may require broader edit permissions',
  },

  debugging: {
    id: 'debugging',
    trigger: 'debug OR fix OR error OR bug',
    additional_read: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/**',
      'artifacts/**/*.log',
    ],
    reason: 'Debugging requires access to tests and logs',
  },

  testing: {
    id: 'testing',
    trigger: 'test OR spec OR coverage',
    additional_edit: [
      'tests/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    reason: 'Testing tasks need to create and edit test files',
  },

  migration: {
    id: 'migration',
    trigger: 'migrate OR migration OR upgrade',
    additional_edit: [
      'supabase/migrations/**',
      'scripts/migrations/**',
    ],
    additional_read: [
      'supabase/migrations/**',
      'docs/migrations/**',
    ],
    reason: 'Migration tasks need access to migration scripts',
  },
};
