#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(process.cwd());

const CANONICAL_SECTIONS = [
  'component_hierarchy_position',
  'component_mount_point',
  'component_input_interface',
  'component_output_interface',
  'component_domain_blocks',
  'component_shared_refs',
];

const LEGACY_TERMS = [
  'hierarchy_position',
  'mount_point',
  'input_props',
  'output_callbacks',
  'domain_blocks',
  'shared_refs',
];

const HISTORICAL_MARKERS = /\b(deprecated|legacy|historical|migration|compat)\b/i;
const RELEVANT_ROOTS = [
  'contract',
  path.join('templates', 'management'),
  'README.md',
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function isObjectLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadContract() {
  const indexPath = path.join(ROOT_DIR, 'contract', 'contract.index.yaml');
  if (!fs.existsSync(indexPath)) {
    fail(`Core contract index not found: ${path.relative(ROOT_DIR, indexPath)}`);
  }

  const indexContent = yaml.parse(fs.readFileSync(indexPath, 'utf8'));
  const layers = Array.isArray(indexContent?.layers) ? indexContent.layers : [];
  const contract = {};

  for (const layer of layers) {
    const layerPath = layer?.path;
    if (typeof layerPath !== 'string' || !layerPath.trim()) continue;
    const absoluteLayerPath = path.join(ROOT_DIR, layerPath);
    if (!fs.existsSync(absoluteLayerPath)) {
      fail(`Core contract layer not found: ${layerPath}`);
    }
    Object.assign(contract, yaml.parse(fs.readFileSync(absoluteLayerPath, 'utf8')));
  }

  if (!isObjectLike(contract)) {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  return contract;
}

function listFiles(targetPath) {
  const absPath = path.join(ROOT_DIR, targetPath);
  if (!fs.existsSync(absPath)) return [];
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return [absPath];

  const out = [];
  for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.frida') {
      continue;
    }
    out.push(...listFiles(path.join(targetPath, entry.name)));
  }
  return out;
}

function findLegacyTermHits() {
  const termPattern = new RegExp(`\\b(${LEGACY_TERMS.join('|')})\\b`, 'g');
  const newPattern = new RegExp(`\\b(${CANONICAL_SECTIONS.join('|')})\\b`, 'g');
  const legacyHits = [];
  const mixedFiles = [];

  for (const target of RELEVANT_ROOTS) {
    for (const absFile of listFiles(target)) {
      const relFile = path.relative(ROOT_DIR, absFile).replace(/\\/g, '/');
      const content = fs.readFileSync(absFile, 'utf8');
      const lines = content.split(/\r?\n/);
      const fileLegacyHits = [];
      let hasNewTerm = false;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!hasNewTerm && newPattern.test(line)) {
          hasNewTerm = true;
        }
        newPattern.lastIndex = 0;

        const matches = line.match(termPattern) || [];
        termPattern.lastIndex = 0;
        if (matches.length === 0) continue;
        if (HISTORICAL_MARKERS.test(line)) continue;

        for (const match of matches) {
          fileLegacyHits.push({ file: relFile, line: i + 1, term: match, text: line.trim() });
        }
      }

      legacyHits.push(...fileLegacyHits);
      if (hasNewTerm && fileLegacyHits.length > 0) {
        mixedFiles.push(relFile);
      }
    }
  }

  return { legacyHits, mixedFiles };
}

function assertListIncludesAll(actual, expected, label, issues) {
  for (const item of expected) {
    if (!actual.includes(item)) {
      issues.push(`${label} missing '${item}'.`);
    }
  }
}

function assertComponentContractSpec(contract, issues) {
  const management = contract.FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT;
  const spec = management?.component_contract_spec;

  if (!isObjectLike(spec)) {
    issues.push('FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.component_contract_spec is missing.');
    return;
  }

  const requiredSections = Array.isArray(spec.required_sections)
    ? spec.required_sections.map((entry) => entry?.id).filter(Boolean)
    : [];
  if (JSON.stringify(requiredSections) !== JSON.stringify(CANONICAL_SECTIONS)) {
    issues.push('component_contract_spec.required_sections must match the canonical component_* section list in order.');
  }

  if (
    typeof spec?.authoritative_rule !== 'string' ||
    !spec.authoritative_rule.includes('Visual projection behavior is authoritative only via FRIDA_VISUAL.component_projection')
  ) {
    issues.push('component_contract_spec.authoritative_rule must defer visual projection authority to FRIDA_VISUAL.component_projection.');
  }

  if (spec?.visual_projection_authorityRef !== 'FRIDA_VISUAL.component_projection') {
    issues.push('component_contract_spec.visual_projection_authorityRef must equal FRIDA_VISUAL.component_projection.');
  }

  const mountRules = spec?.section_field_rules?.component_mount_point;
  if (!isObjectLike(mountRules)) {
    issues.push('component_contract_spec.section_field_rules.component_mount_point is missing.');
  } else {
    assertListIncludesAll(mountRules.required_fields || [], ['slotRef', 'mount_kind'], 'component_mount_point.required_fields', issues);
    assertListIncludesAll(mountRules.optional_fields || [], ['mounted_child_boundaryRefs'], 'component_mount_point.optional_fields', issues);
  }

  const outputRules = spec?.section_field_rules?.component_output_interface;
  if (!isObjectLike(outputRules)) {
    issues.push('component_contract_spec.section_field_rules.component_output_interface is missing.');
  } else {
    assertListIncludesAll(outputRules.required_exit_entry_fields || [], ['id', 'outcome'], 'component_output_interface.required_exit_entry_fields', issues);
    assertListIncludesAll(outputRules.optional_exit_entry_fields || [], ['target_boundaryRef', 'return_target_boundaryRef'], 'component_output_interface.optional_exit_entry_fields', issues);
    assertListIncludesAll(outputRules.allowed_outcomes || [], ['continue', 'return', 'exit'], 'component_output_interface.allowed_outcomes', issues);
  }

  const sharedRules = spec?.section_field_rules?.component_shared_refs;
  if (!isObjectLike(sharedRules)) {
    issues.push('component_contract_spec.section_field_rules.component_shared_refs is missing.');
  } else {
    assertListIncludesAll(sharedRules.optional_fields || [], ['refs'], 'component_shared_refs.optional_fields', issues);
  }

  const example = spec.example_component_contract;
  if (!isObjectLike(example)) {
    issues.push('component_contract_spec.example_component_contract is missing.');
    return;
  }

  for (const section of CANONICAL_SECTIONS) {
    if (!(section in example)) {
      issues.push(`component_contract_spec.example_component_contract missing '${section}'.`);
    }
  }

  const exits = example?.component_output_interface?.exits;
  if (!Array.isArray(exits) || exits.length === 0) {
    issues.push('component_contract_spec.example_component_contract.component_output_interface.exits must contain at least one canonical exit example.');
  } else {
    const outcomes = exits.map((entry) => entry?.outcome).filter(Boolean);
    if (!outcomes.includes('continue') || !outcomes.includes('return')) {
      issues.push('component_contract_spec.example_component_contract must demonstrate continue and return outcomes.');
    }
  }
}

function assertVisualSemantics(contract, issues) {
  const visual = contract.FRIDA_VISUAL;
  if (!isObjectLike(visual?.component_projection)) {
    issues.push('FRIDA_VISUAL.component_projection is missing.');
    return;
  }

  const projection = visual.component_projection;
  if (projection.primary_unit !== 'component-level contract file') {
    issues.push('FRIDA_VISUAL.component_projection.primary_unit must equal "component-level contract file".');
  }

  const order = Array.isArray(projection?.current_boundary_establishment?.order)
    ? projection.current_boundary_establishment.order
    : [];
  const expectedOrder = [
    'component_hierarchy_position',
    'component_mount_point',
    'component_input_interface',
    'component_output_interface',
  ];
  if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) {
    issues.push('FRIDA_VISUAL.component_projection.current_boundary_establishment.order must match the canonical boundary establishment order.');
  }

  if (projection?.drill_in?.source_field !== 'component_mount_point.mounted_child_boundaryRefs') {
    issues.push('FRIDA_VISUAL.component_projection.drill_in.source_field must equal component_mount_point.mounted_child_boundaryRefs.');
  }

  const projectionDomains = projection?.projection_domains;
  for (const domain of ['topology', 'flow', 'specification']) {
    if (!isObjectLike(projectionDomains?.[domain])) {
      issues.push(`FRIDA_VISUAL.component_projection.projection_domains.${domain} must exist.`);
    }
  }

  const mappingRules = projection?.mapping_rules;
  for (const section of CANONICAL_SECTIONS) {
    if (!isObjectLike(mappingRules?.[section])) {
      issues.push(`FRIDA_VISUAL.component_projection.mapping_rules.${section} must exist.`);
    }
  }

  const drillOut = Array.isArray(projection?.drill_out?.source_fields) ? projection.drill_out.source_fields : [];
  assertListIncludesAll(
    drillOut,
    [
      'component_output_interface.outcome',
      'component_output_interface.target_boundaryRef',
      'component_output_interface.return_target_boundaryRef',
    ],
    'FRIDA_VISUAL.component_projection.drill_out.source_fields',
    issues,
  );

  if (
    projection?.continuation_return_semantics?.source_fields?.continuation !== 'component_output_interface.target_boundaryRef' ||
    projection?.continuation_return_semantics?.source_fields?.return !== 'component_output_interface.return_target_boundaryRef'
  ) {
    issues.push('FRIDA_VISUAL.component_projection.continuation_return_semantics must map continuation and return to the canonical component_output_interface fields.');
  }
}

function assertValidationCoverage(contract, issues) {
  const reporting = contract.FRIDA_VALIDATION_CHECKLIST;
  if (!isObjectLike(reporting)) {
    issues.push('FRIDA_VALIDATION_CHECKLIST is missing.');
    return;
  }

  const contractChecks = Array.isArray(reporting.contract_consistency) ? reporting.contract_consistency : [];
  const visualChecks = Array.isArray(reporting.visual_consistency) ? reporting.visual_consistency : [];
  assertListIncludesAll(
    contractChecks,
    [
      'Component contract files use the canonical component boundary section ids and do not retain legacy aliases unless a declared temporary deprecation window exists.',
      'component_mount_point.mounted_child_boundaryRefs and component_output_interface.*boundaryRef fields resolve only to explicit component boundaries when present.',
      'Component-level contract examples and snippets use only the canonical component_* vocabulary.',
      'Mixed legacy/new component-boundary namespace use in active definitions is a hard failure.',
    ],
    'FRIDA_VALIDATION_CHECKLIST.contract_consistency',
    issues,
  );
  assertListIncludesAll(
    visualChecks,
    [
      'FRIDA_VISUAL.component_projection is the authoritative source for component-boundary visual projection semantics.',
      'FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.component_contract_spec defines source-contract structure only and does not redefine topology/flow/specification mapping.',
      'A component-level contract file is the primary visual projection unit.',
      'Parent specification view does not auto-expand mounted child internals; cross-component drill-in requires component_mount_point.mounted_child_boundaryRefs.',
      'Flow projection reads canonical exits, outcomes, and continuation/return targeting only from component_output_interface.',
      'component_shared_refs project dependency edges only and do not override ownership or boundary semantics.',
    ],
    'FRIDA_VALIDATION_CHECKLIST.visual_consistency',
    issues,
  );
}

function assertGuardCoverage(contract, issues) {
  const enforcement = contract.FRIDA_ENFORCEMENT;
  const validationRules = contract.FRIDA_VALIDATION_RULES;
  if (!isObjectLike(enforcement) || !isObjectLike(validationRules)) {
    issues.push('FRIDA_ENFORCEMENT or FRIDA_VALIDATION_RULES is missing.');
    return;
  }

  const invariantIds = Array.isArray(enforcement.invariants) ? enforcement.invariants.map((entry) => entry?.id).filter(Boolean) : [];
  assertListIncludesAll(
    invariantIds,
    [
      'component_boundary_sections_complete',
      'component_boundary_refs_resolve',
      'component_output_exit_semantics_canonical',
      'component_child_non_auto_expand',
      'component_shared_refs_dependency_only',
      'component_legacy_namespace_forbidden',
      'component_boundary_visual_primary',
    ],
    'FRIDA_ENFORCEMENT.invariants',
    issues,
  );

  const policyIds = Array.isArray(enforcement.policies) ? enforcement.policies.map((entry) => entry?.id).filter(Boolean) : [];
  const expectedPolicies = [
    'GUARD_COMPONENT_BOUNDARY_SECTIONS_COMPLETE',
    'GUARD_COMPONENT_BOUNDARY_REFS_RESOLVE',
    'GUARD_COMPONENT_EXIT_SEMANTICS_COMPLETE',
    'GUARD_COMPONENT_CHILD_BOUNDARY_NO_INLINE',
    'GUARD_COMPONENT_SHARED_REFS_DEPENDENCY_ONLY',
    'GUARD_COMPONENT_LEGACY_TERMS_FORBIDDEN',
    'GUARD_COMPONENT_MIXED_NAMESPACE_FORBIDDEN',
    'GUARD_COMPONENT_VISUAL_BOUNDARY_FIRST',
  ];
  assertListIncludesAll(policyIds, expectedPolicies, 'FRIDA_ENFORCEMENT.policies', issues);
  assertListIncludesAll(validationRules.contract_consistency || [], expectedPolicies.filter((id) => id !== 'GUARD_COMPONENT_CHILD_BOUNDARY_NO_INLINE' && id !== 'GUARD_COMPONENT_VISUAL_BOUNDARY_FIRST'), 'FRIDA_VALIDATION_RULES.contract_consistency', issues);
  assertListIncludesAll(validationRules.visual_guards || [], ['GUARD_COMPONENT_CHILD_BOUNDARY_NO_INLINE', 'GUARD_COMPONENT_VISUAL_BOUNDARY_FIRST'], 'FRIDA_VALIDATION_RULES.visual_guards', issues);
}

function main() {
  console.log('🔍 Checking component-boundary contract integrity...');
  const contract = loadContract();
  const issues = [];

  assertComponentContractSpec(contract, issues);
  assertVisualSemantics(contract, issues);
  assertValidationCoverage(contract, issues);
  assertGuardCoverage(contract, issues);

  const { legacyHits, mixedFiles } = findLegacyTermHits();
  for (const hit of legacyHits) {
    issues.push(`Legacy term '${hit.term}' found in active contract surface: ${hit.file}:${hit.line} -> ${hit.text}`);
  }
  for (const file of mixedFiles) {
    issues.push(`Mixed legacy/new component namespace detected in active contract surface: ${file}`);
  }

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    fail(`Component-boundary contract integrity FAILED with ${issues.length} issue(s).`);
  }

  console.log('✅ Component-boundary contract integrity OK');
}

try {
  main();
} catch (error) {
  fail(`check-component-boundary-contract failed: ${error instanceof Error ? error.message : String(error)}`);
}
