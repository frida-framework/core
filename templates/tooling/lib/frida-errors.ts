/**
 * FRIDA Structured Error System
 * 
 * All FRIDA errors must follow this structured format to provide
 * actionable guidance to AI agents.
 */

export interface FridaError {
  code: string;              // Error code (e.g., "FORBIDDEN_PATH_VIOLATION")
  agent: string;             // Agent that triggered error
  action: string;            // Action attempted (read/edit/create/delete)
  path: string;              // Path that caused error
  constraint: string;        // Which constraint was violated
  solution: {
    primary: string;         // Main solution
    command?: string;        // Command to run
    docs?: string;           // Documentation link
  };
  alternatives?: string[];   // Alternative approaches
}

export class FridaErrorFormatter {
  static format(error: FridaError): string {
    const lines = [
      '❌ CONSTRAINT VIOLATION\n',
      `Agent: ${error.agent}`,
      `Action: Attempted to ${error.action} ${error.path}`,
      `Constraint: ${error.constraint}\n`,
      '━'.repeat(60) + '\n',
      '💡 SOLUTION\n',
      error.solution.primary,
    ];

    if (error.solution.command) {
      lines.push(`\n  Run:  ${error.solution.command}`);
    }

    if (error.solution.docs) {
      lines.push(`  Docs: ${error.solution.docs}`);
    }

    lines.push('\n' + '━'.repeat(60));

    if (error.alternatives && error.alternatives.length > 0) {
      lines.push('\nALTERNATIVES');
      error.alternatives.forEach(alt => {
        lines.push(`• ${alt}`);
      });
    }

    return lines.join('\n');
  }

  static formatMultiple(errors: FridaError[]): string {
    return errors.map(e => this.format(e)).join('\n\n');
  }
}

// Common error templates
export const ErrorTemplates = {
  FORBIDDEN_PATH: (agent: string, path: string, redirectPath?: string): FridaError => ({
    code: 'FORBIDDEN_PATH_VIOLATION',
    agent,
    action: 'edit',
    path,
    constraint: `Path forbidden by ${agent} profile`,
    solution: {
      primary: redirectPath
        ? `This path is read-only. Modify ${redirectPath} instead.`
        : 'This path is forbidden by agent profile constraints.',
      command: redirectPath ? 'npm run mapper:all' : undefined,
      docs: redirectPath ? 'docs/mapper/integration.md' : undefined,
    },
    alternatives: redirectPath
      ? ['Request zone boundary change in contract', 'Use different agent profile']
      : ['Request zone boundary change in contract'],
  }),

  UNDEFINED_INVARIANT: (profileId: string, invariantId: string): FridaError => ({
    code: 'UNDEFINED_INVARIANT',
    agent: 'generator',
    action: 'reference',
    path: `TASK_PROFILES.${profileId}.invariants`,
    constraint: 'Referenced invariant does not exist',
    solution: {
      primary: `Invariant '${invariantId}' is referenced but not defined.`,
      command: 'Add to INVARIANTS block or remove reference',
      docs: '.frida/inbox/app-contract/contract.index.yaml',
    },
  }),

  PATH_NOT_FOUND: (path: string, similar: string[]): FridaError => ({
    code: 'PATH_NOT_FOUND',
    agent: 'validator',
    action: 'validate',
    path,
    constraint: 'Path does not exist in filesystem',
    solution: {
      primary: similar.length > 0
        ? `Path '${path}' not found. Did you mean one of these?`
        : `Path '${path}' not found in filesystem.`,
    },
    alternatives: similar,
  }),

  CYCLIC_DEPENDENCY: (cycle: string[]): FridaError => ({
    code: 'CYCLIC_DEPENDENCY',
    agent: 'validator',
    action: 'validate',
    path: 'INVARIANTS',
    constraint: 'Cyclic dependency detected',
    solution: {
      primary: `Cyclic dependency: ${cycle.join(' → ')}`,
      command: 'Remove circular reference from INVARIANTS',
      docs: 'docs/contract/invariants.md',
    },
  }),

  PATH_CONFLICT: (profileId: string, path: string): FridaError => ({
    code: 'PATH_CONFLICT',
    agent: 'validator',
    action: 'validate',
    path: `TASK_PROFILES.${profileId}.security`,
    constraint: 'Path appears in both allow and forbid lists',
    solution: {
      primary: `Path '${path}' is both allowed and forbidden.`,
      command: 'Remove from either allow or forbid list',
      docs: 'docs/contract/security.md',
    },
  }),
};
