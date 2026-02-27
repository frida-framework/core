#!/usr/bin/env tsx
/**
 * Contract Validator
 * 
 * Validates contract/contract.cbmd.yaml before generation.
 * Ensures contract is internally consistent and references valid filesystem paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { glob } from 'glob';
import { loadModularContract } from './lib/load-contract.mjs';

// === Types ===

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

interface ValidationError {
  code: string;
  message: string;
  location?: string;
  suggestion?: string;
}

interface ValidationWarning {
  code: string;
  message: string;
  location?: string;
}

interface Contract {
  TASK_PROFILES?: any;
  INVARIANTS?: any;
  FRIDA_GUARDS_BASELINE?: any;
  PROJECT_GUARDS?: any;
  GUARDS?: any;
  PATHS?: any;
  ZONES?: any;
  RESOURCES?: any;
  APPLICATIONS?: any;
  TRANSITIONS?: any;
  [key: string]: any;
}

// === Config ===

const ROOT_DIR = path.resolve(__dirname, '..');

// === Validators ===

class ContractValidator {
  private contract: Contract;
  private errors: ValidationError[] = [];
  private warnings: ValidationWarning[] = [];
  private existingPaths: Set<string> = new Set();

  constructor(contract: Contract) {
    this.contract = contract;
  }

  async validate(): Promise<ValidationResult> {
    console.log('🔍 Validating contract...\n');

    // Collect existing filesystem paths
    await this.collectExistingPaths();

    // Run validation rules
    this.validateYAMLStructure();
    this.validateTaskProfiles();
    this.validateInvariants();
    this.validateGuards();
    this.validatePaths();
    this.validateResourceReferences();
    this.validateTransitionReferences();
    this.checkCyclicDependencies();
    this.checkPathConflicts();
    this.checkDuplicateKeywords();

    const result = {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
    };

    this.printResults(result);
    return result;
  }

  private async collectExistingPaths(): Promise<void> {
    // Collect all existing files and directories
    const patterns = [
      'src/**',
      'scripts/**',
      'dist/**',
      'supabase/**',
      'tests/**',
      'docs/**',
      '.specs/**',
    ];

    for (const pattern of patterns) {
      const files = await glob(pattern, { cwd: ROOT_DIR, dot: false });
      files.forEach(f => this.existingPaths.add(f));
    }

    console.log(`📁 Collected ${this.existingPaths.size} filesystem paths\n`);
  }

  private validateYAMLStructure(): void {
    const requiredBlocks = ['TASK_PROFILES', 'INVARIANTS'];

    for (const block of requiredBlocks) {
      if (!this.contract[block]) {
        this.errors.push({
          code: 'MISSING_REQUIRED_BLOCK',
          message: `Required block '${block}' is missing from contract`,
          location: 'contract root',
          suggestion: `Add ${block} block to modular contract`
        });
      }
    }

    const hasAnyGuardBlock = !!(
      this.contract.FRIDA_GUARDS_BASELINE ||
      this.contract.PROJECT_GUARDS ||
      this.contract.GUARDS
    );
    if (!hasAnyGuardBlock) {
      this.errors.push({
        code: 'MISSING_REQUIRED_BLOCK',
        message: "At least one guard block is required: FRIDA_GUARDS_BASELINE, PROJECT_GUARDS, or GUARDS",
        location: 'contract root',
        suggestion: 'Add composable guard blocks or legacy GUARDS block'
      });
    }
  }

  private validateTaskProfiles(): void {
    const profiles = this.contract.TASK_PROFILES || {};

    for (const [profileId, profile] of Object.entries(profiles)) {
      const p = profile as any;

      // Check required fields
      if (!p.description) {
        this.warnings.push({
          code: 'MISSING_DESCRIPTION',
          message: `Profile '${profileId}' missing description`,
          location: `TASK_PROFILES.${profileId}`
        });
      }

      if (!p.keywords || !Array.isArray(p.keywords)) {
        this.errors.push({
          code: 'MISSING_KEYWORDS',
          message: `Profile '${profileId}' missing or invalid keywords array`,
          location: `TASK_PROFILES.${profileId}`,
          suggestion: 'Add keywords: [keyword1, keyword2, ...]'
        });
      }

      if (!p.role) {
        this.errors.push({
          code: 'MISSING_ROLE',
          message: `Profile '${profileId}' missing role`,
          location: `TASK_PROFILES.${profileId}`,
          suggestion: 'Add role: FRONTEND_AGENT | BACKEND_AGENT | ...'
        });
      }

      // Validate security paths
      if (p.security) {
        this.validateSecurityPaths(profileId, p.security);
      }

      // Validate invariant references
      if (p.invariants) {
        this.validateInvariantReferences(profileId, p.invariants);
      }
    }
  }

  private validateSecurityPaths(profileId: string, security: any): void {
    const pathLists = [
      { key: 'read_allow', paths: security.read_allow },
      { key: 'edit_allow', paths: security.edit_allow },
      { key: 'forbid', paths: security.forbid },
      { key: 'edit_forbid', paths: security.edit_forbid },
    ];

    for (const { key, paths } of pathLists) {
      if (!paths) continue;

      if (!Array.isArray(paths)) {
        this.errors.push({
          code: 'INVALID_PATH_LIST',
          message: `security.${key} must be an array`,
          location: `TASK_PROFILES.${profileId}.security.${key}`
        });
        continue;
      }

      for (const pathPattern of paths) {
        this.validatePathPattern(pathPattern, `TASK_PROFILES.${profileId}.security.${key}`);
      }
    }
  }

  private validatePathPattern(pattern: string, location: string): void {
    // Check for common mistakes
    if (pattern.includes('\\')) {
      this.warnings.push({
        code: 'BACKSLASH_IN_PATH',
        message: `Path contains backslash: '${pattern}'. Use forward slashes.`,
        location
      });
    }

    // Check if path exists (for non-wildcard patterns)
    if (!pattern.includes('*')) {
      const normalized = pattern.replace(/^\.\//, '').replace(/^\//, '');
      if (!this.existingPaths.has(normalized) && !fs.existsSync(path.join(ROOT_DIR, normalized))) {
        // Try to find similar paths
        const similar = this.findSimilarPaths(normalized);

        this.warnings.push({
          code: 'PATH_NOT_FOUND',
          message: `Path '${pattern}' does not exist in filesystem`,
          location: location + (similar.length > 0 ? `\nDid you mean: ${similar.join(', ')}?` : '')
        });
      }
    } else {
      // Validate glob pattern
      const normalized = pattern.replace(/^\.\//, '').replace(/^\//, '');
      const matches = Array.from(this.existingPaths).filter(p => this.matchGlob(p, normalized));

      if (matches.length === 0) {
        this.warnings.push({
          code: 'GLOB_NO_MATCHES',
          message: `Glob pattern '${pattern}' matches no files`,
          location
        });
      }
    }
  }

  private matchGlob(path: string, pattern: string): boolean {
    // Simple glob matching (** means any depth, * means any in segment)
    const regex = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\//g, '\\/');
    return new RegExp(`^${regex}$`).test(path);
  }

  private findSimilarPaths(target: string): string[] {
    // Simple Levenshtein-based similarity
    const similar: string[] = [];
    const targetParts = target.split('/');

    for (const existing of this.existingPaths) {
      const existingParts = existing.split('/');
      if (targetParts[0] === existingParts[0]) { // Same root
        const distance = this.levenshteinDistance(target, existing);
        if (distance < 5) {
          similar.push(existing);
        }
      }
    }

    return similar.slice(0, 3); // Top 3
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + cost
        );
      }
    }

    return matrix[b.length][a.length];
  }

  private validateInvariantReferences(profileId: string, invariants: string[]): void {
    if (!Array.isArray(invariants)) {
      this.errors.push({
        code: 'INVALID_INVARIANTS',
        message: `invariants must be an array`,
        location: `TASK_PROFILES.${profileId}.invariants`
      });
      return;
    }

    const definedInvariants = this.contract.INVARIANTS || {};

    for (const invId of invariants) {
      if (!definedInvariants[invId]) {
        this.errors.push({
          code: 'UNDEFINED_INVARIANT',
          message: `Invariant '${invId}' is referenced but not defined`,
          location: `TASK_PROFILES.${profileId}.invariants`,
          suggestion: `Add invariant '${invId}' to INVARIANTS block or remove reference`
        });
      }
    }
  }

  private validateInvariants(): void {
    const invariants = this.contract.INVARIANTS || {};

    for (const [invId, inv] of Object.entries(invariants)) {
      const i = inv as any;

      if (!i.id) {
        this.errors.push({
          code: 'MISSING_INVARIANT_ID',
          message: `Invariant '${invId}' missing id field`,
          location: `INVARIANTS.${invId}`,
          suggestion: `Add id: "${invId}"`
        });
      }

      if (!i.text) {
        this.errors.push({
          code: 'MISSING_INVARIANT_TEXT',
          message: `Invariant '${invId}' missing text field`,
          location: `INVARIANTS.${invId}`,
          suggestion: 'Add text: "Description of invariant"'
        });
      }

      // Check for duplicate IDs
      if (i.id && i.id !== invId) {
        this.warnings.push({
          code: 'INVARIANT_ID_MISMATCH',
          message: `Invariant key '${invId}' does not match id field '${i.id}'`,
          location: `INVARIANTS.${invId}`
        });
      }
    }
  }

  private validateGuards(): void {
    const guardLayers: Array<{ name: string; block: any }> = [
      { name: 'FRIDA_GUARDS_BASELINE', block: this.contract.FRIDA_GUARDS_BASELINE },
      { name: 'PROJECT_GUARDS', block: this.contract.PROJECT_GUARDS },
      { name: 'GUARDS', block: this.contract.GUARDS },
    ].filter(layer => !!layer.block);

    const effectiveGuardIds = new Set<string>();
    const globalGuardRefs: string[] = [];
    const seenGlobalRefs = new Set<string>();

    for (const layer of guardLayers) {
      const block = layer.block;

      if (block.globalGuardRefs !== undefined && !Array.isArray(block.globalGuardRefs)) {
        this.errors.push({
          code: 'INVALID_GUARDS',
          message: `${layer.name}.globalGuardRefs must be an array`,
          location: `${layer.name}.globalGuardRefs`
        });
      }

      for (const ref of block.globalGuardRefs || []) {
        if (typeof ref !== 'string' || !ref.trim()) {
          this.errors.push({
            code: 'INVALID_GUARDS',
            message: `${layer.name}.globalGuardRefs contains non-string or empty value`,
            location: `${layer.name}.globalGuardRefs`
          });
          continue;
        }
        if (!seenGlobalRefs.has(ref)) {
          seenGlobalRefs.add(ref);
          globalGuardRefs.push(ref);
        }
      }

      if (block.guards !== undefined && !Array.isArray(block.guards)) {
        this.errors.push({
          code: 'INVALID_GUARDS',
          message: `${layer.name}.guards must be an array`,
          location: `${layer.name}.guards`
        });
        continue;
      }

      const localIds = new Set<string>();
      for (let i = 0; i < (block.guards || []).length; i++) {
        const guard = block.guards[i];

        if (!guard?.id) {
          this.errors.push({
            code: 'MISSING_GUARD_ID',
            message: `Guard at index ${i} missing id`,
            location: `${layer.name}.guards[${i}]`
          });
          continue;
        }

        if (localIds.has(guard.id)) {
          this.errors.push({
            code: 'DUPLICATE_GUARD_ID',
            message: `Duplicate guard id in ${layer.name}: '${guard.id}'`,
            location: `${layer.name}.guards[${i}]`
          });
          continue;
        }
        localIds.add(guard.id);

        if (!guard.kind) {
          this.errors.push({
            code: 'MISSING_GUARD_KIND',
            message: `Guard '${guard.id}' missing kind`,
            location: `${layer.name}.guards[${i}]`
          });
        }

        if (!guard.statement) {
          this.errors.push({
            code: 'MISSING_GUARD_STATEMENT',
            message: `Guard '${guard.id}' missing statement`,
            location: `${layer.name}.guards[${i}]`
          });
        }

        // Effective registry uses deterministic override by layer order.
        if (!effectiveGuardIds.has(guard.id)) {
          effectiveGuardIds.add(guard.id);
        }
      }
    }

    for (const ref of globalGuardRefs) {
      if (!effectiveGuardIds.has(ref)) {
        this.errors.push({
          code: 'UNRESOLVED_GUARD_REF',
          message: `globalGuardRef '${ref}' does not resolve to any effective guard id`,
          location: 'effectiveGuardRegistry.globalGuardRefs'
        });
      }
    }

    for (const [zoneId, zone] of Object.entries(this.contract.ZONES || {})) {
      const refs = (zone as any).guardRefs || [];
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref === 'string' && !effectiveGuardIds.has(ref)) {
          this.errors.push({
            code: 'UNRESOLVED_GUARD_REF',
            message: `Zone guardRef '${ref}' is not defined in effective guard registry`,
            location: `ZONES.${zoneId}.guardRefs`
          });
        }
      }
    }
  }

  private validatePaths(): void {
    // Validate that referenced paths in PATHS block exist
    const paths = this.contract.PATHS || {};

    for (const [key, value] of Object.entries(paths)) {
      if (typeof value === 'string') {
        this.validatePathPattern(value, `PATHS.${key}`);
      } else if (typeof value === 'object') {
        for (const [subkey, subvalue] of Object.entries(value)) {
          if (typeof subvalue === 'string') {
            this.validatePathPattern(subvalue, `PATHS.${key}.${subkey}`);
          }
        }
      }
    }
  }

  private validateResourceReferences(): void {
    const applications = this.contract.APPLICATIONS || {};
    const resources = this.contract.RESOURCES || {};
    const resourceKeys = new Set(Object.keys(resources));

    for (const [appId, app] of Object.entries(applications)) {
      const a = app as any;
      const usedResources = a.usesResources || [];

      for (const resKey of usedResources) {
        if (!resourceKeys.has(resKey)) {
          this.errors.push({
            code: 'UNDEFINED_RESOURCE',
            message: `Resource '${resKey}' is referenced but not defined`,
            location: `APPLICATIONS.${appId}.usesResources`,
            suggestion: `Add resource '${resKey}' to RESOURCES block or remove reference`
          });
        }
      }
    }
  }

  private validateTransitionReferences(): void {
    const applications = this.contract.APPLICATIONS || {};
    const transitions = this.contract.TRANSITIONS || {};
    const _transitionKeys = new Set(Object.keys(transitions));
    const appKeys = new Set(Object.keys(applications));

    for (const [transId, trans] of Object.entries(transitions)) {
      const t = trans as any;

      // Validate from/to apps exist
      if (t.from && t.from !== 'external' && !appKeys.has(t.from)) {
        this.errors.push({
          code: 'UNDEFINED_TRANSITION_SOURCE',
          message: `Transition '${transId}' references undefined source app '${t.from}'`,
          location: `TRANSITIONS.${transId}.from`,
          suggestion: `Add app '${t.from}' to APPLICATIONS or fix transition`
        });
      }

      if (t.to && !appKeys.has(t.to)) {
        this.errors.push({
          code: 'UNDEFINED_TRANSITION_TARGET',
          message: `Transition '${transId}' references undefined target app '${t.to}'`,
          location: `TRANSITIONS.${transId}.to`,
          suggestion: `Add app '${t.to}' to APPLICATIONS or fix transition`
        });
      }
    }
  }

  private checkCyclicDependencies(): void {
    // Check for cyclic dependencies in invariants
    const invariants = this.contract.INVARIANTS || {};
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (invId: string, path: string[]): boolean => {
      if (recursionStack.has(invId)) {
        this.errors.push({
          code: 'CYCLIC_DEPENDENCY',
          message: `Cyclic dependency detected: ${path.join(' → ')} → ${invId}`,
          location: `INVARIANTS.${invId}`,
          suggestion: 'Remove circular reference'
        });
        return true;
      }

      if (visited.has(invId)) return false;

      visited.add(invId);
      recursionStack.add(invId);

      // Check if this invariant references other invariants
      // (simplified check - would need to parse text for references)

      recursionStack.delete(invId);
      return false;
    };

    for (const invId of Object.keys(invariants)) {
      if (!visited.has(invId)) {
        detectCycle(invId, []);
      }
    }
  }

  private checkPathConflicts(): void {
    const profiles = this.contract.TASK_PROFILES || {};

    for (const [profileId, profile] of Object.entries(profiles)) {
      const p = profile as any;
      if (!p.security) continue;

      const allowed = new Set<string>([
        ...(p.security.read_allow || []),
        ...(p.security.edit_allow || [])
      ]);

      const forbidden = new Set<string>([
        ...(p.security.forbid || []),
        ...(p.security.edit_forbid || [])
      ]);

      // Check for paths in both allowed and forbidden
      for (const path of allowed) {
        if (forbidden.has(path)) {
          this.errors.push({
            code: 'PATH_CONFLICT',
            message: `Path '${path}' is both allowed and forbidden`,
            location: `TASK_PROFILES.${profileId}.security`,
            suggestion: 'Remove from either allow or forbid list'
          });
        }
      }
    }
  }

  private checkDuplicateKeywords(): void {
    const profiles = this.contract.TASK_PROFILES || {};
    const keywordMap = new Map<string, string[]>();

    for (const [profileId, profile] of Object.entries(profiles)) {
      const p = profile as any;
      const keywords = p.keywords || [];

      for (const keyword of keywords) {
        if (!keywordMap.has(keyword)) {
          keywordMap.set(keyword, []);
        }
        keywordMap.get(keyword)!.push(profileId);
      }
    }

    for (const [keyword, profileIds] of keywordMap) {
      if (profileIds.length > 1) {
        this.warnings.push({
          code: 'DUPLICATE_KEYWORD',
          message: `Keyword '${keyword}' used in multiple profiles: ${profileIds.join(', ')}`,
          location: 'TASK_PROFILES (multiple)',
        });
      }
    }
  }

  private printResults(result: ValidationResult): void {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (result.errors.length > 0) {
      console.log(`❌ VALIDATION FAILED (${result.errors.length} errors)\n`);

      for (const error of result.errors) {
        console.log(`❌ ${error.code}`);
        console.log(`   ${error.message}`);
        if (error.location) console.log(`   Location: ${error.location}`);
        if (error.suggestion) console.log(`   💡 ${error.suggestion}`);
        console.log();
      }
    }

    if (result.warnings.length > 0) {
      console.log(`⚠️  WARNINGS (${result.warnings.length})\n`);

      for (const warning of result.warnings) {
        console.log(`⚠️  ${warning.code}`);
        console.log(`   ${warning.message}`);
        if (warning.location) console.log(`   Location: ${warning.location}`);
        console.log();
      }
    }

    if (result.errors.length === 0) {
      console.log('✅ CONTRACT VALIDATION PASSED\n');
      if (result.warnings.length === 0) {
        console.log('   No warnings.\n');
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

// === Main ===

async function main() {
  let contract: Contract;

  try {
    contract = loadModularContract(ROOT_DIR) as Contract;
  } catch (error) {
    console.error('❌ Error: Failed to load modular contract');
    console.error(error);
    process.exit(1);
  }

  const validator = new ContractValidator(contract);
  const result = await validator.validate();

  process.exit(result.valid ? 0 : 1);
}

main().catch(console.error);
