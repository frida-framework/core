#!/usr/bin/env node
import path from 'node:path';
import { loadEffectiveVisualContractDocument } from '@sistemado/frida';

const ROOT_DIR = path.resolve(process.cwd());

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function loadContract() {
  const loaded = loadEffectiveVisualContractDocument(ROOT_DIR);
  const contract = loaded?.parsed;
  if (!contract || typeof contract !== 'object') {
    fail('Contract artifact parsed to empty or non-object value.');
  }
  return { raw: loaded.raw, contract };
}

function isObjectLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePathRef(paths, ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    return null;
  }

  const parts = ref.split('.');
  if (parts[0] !== 'PATHS') {
    return null;
  }

  let cursor = { PATHS: paths };
  for (const part of parts) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      return null;
    }
    cursor = cursor[part];
  }

  return typeof cursor === 'string' && cursor.trim() ? cursor : null;
}

function assertPathRef(contract, refPath, issues) {
  const parts = refPath.split('.');
  let cursor = contract;
  for (const part of parts) {
    if (!isObjectLike(cursor) || !(part in cursor)) {
      issues.push(`Missing required path: ${refPath}`);
      return;
    }
    cursor = cursor[part];
  }
  if (typeof cursor !== 'string' || !cursor.trim()) {
    issues.push(`Path must be a non-empty string: ${refPath}`);
  }
}

function assertVisualContracts(contract, issues) {
  if (!isObjectLike(contract.FRIDA_VISUAL)) {
    issues.push('FRIDA_VISUAL block is missing or invalid.');
    return;
  }

  if (typeof contract.FRIDA_VISUAL.version !== 'string' || !contract.FRIDA_VISUAL.version.trim()) {
    issues.push('FRIDA_VISUAL.version must be a non-empty string.');
  }

  if (contract.FRIDA_VISUAL.overlay_format !== 'json') {
    issues.push('FRIDA_VISUAL.overlay_format must equal json.');
  }

  assertPathRef(contract, 'FRIDA_VISUAL.overlay_pathRef', issues);

  // Schema-driven mode is authoritative now; VISUAL_SCHEMA remains optional.
  if (isObjectLike(contract.VISUAL_SCHEMA) && (typeof contract.VISUAL_SCHEMA.version !== 'string' || !contract.VISUAL_SCHEMA.version.trim())) {
    issues.push('VISUAL_SCHEMA.version must be a non-empty string when VISUAL_SCHEMA is present.');
  }
}

function assertVisualPaths(contract, issues) {
  assertPathRef(contract, 'FRIDA_CONFIG.visual.overlay_pathRef', issues);
  assertPathRef(contract, 'PATHS.visual.overlayFile', issues);

  const configPath = resolvePathRef(contract.PATHS, contract?.FRIDA_CONFIG?.visual?.overlay_pathRef);
  const visualPath = resolvePathRef(contract.PATHS, contract?.FRIDA_VISUAL?.overlay_pathRef);
  const canonicalPath = contract?.PATHS?.visual?.overlayFile;

  if (!configPath) {
    issues.push('FRIDA_CONFIG.visual.overlay_pathRef must resolve through PATHS.');
  }

  if (!visualPath) {
    issues.push('FRIDA_VISUAL.overlay_pathRef must resolve through PATHS.');
  }

  if (typeof canonicalPath !== 'string' || !canonicalPath.trim()) {
    issues.push('PATHS.visual.overlayFile must be a non-empty string.');
    return;
  }

  if (configPath && configPath !== canonicalPath) {
    issues.push('FRIDA_CONFIG.visual.overlay_pathRef must resolve to PATHS.visual.overlayFile.');
  }

  if (visualPath && visualPath !== canonicalPath) {
    issues.push('FRIDA_VISUAL.overlay_pathRef must resolve to PATHS.visual.overlayFile.');
  }
}

function assertVisualizerGovernanceContract(contract, issues) {
  const visual = contract.FRIDA_VISUAL;
  if (!isObjectLike(visual)) {
    return;
  }

  const targetFunction = visual.target_function;
  if (!isObjectLike(targetFunction)) {
    issues.push('FRIDA_VISUAL.target_function is missing or invalid.');
  } else {
    if (targetFunction.statement !== 'Represent the architecture of the target application as an interactive diagram.') {
      issues.push('FRIDA_VISUAL.target_function.statement must define the interactive target-application architecture diagram.');
    }
    if (
      typeof targetFunction?.primary_surface_rule !== 'string' ||
      !targetFunction.primary_surface_rule.includes('interactive diagram as the primary product surface')
    ) {
      issues.push('FRIDA_VISUAL.target_function.primary_surface_rule must make the diagram the primary product surface.');
    }
    if (
      typeof targetFunction?.semantic_scope_rule !== 'string' ||
      !targetFunction.semantic_scope_rule.includes('overlay semantics only')
    ) {
      issues.push('FRIDA_VISUAL.target_function.semantic_scope_rule must keep visualizer semantics overlay-driven only.');
    }
  }

  const legality = visual.execution_legality;
  if (!isObjectLike(legality)) {
    issues.push('FRIDA_VISUAL.execution_legality is missing or invalid.');
  } else {
    if (legality.allowed_repository_scope !== 'target_app_repo_only') {
      issues.push("FRIDA_VISUAL.execution_legality.allowed_repository_scope must equal 'target_app_repo_only'.");
    }
    if (legality.forbidden_repository_scope !== 'frida_repo') {
      issues.push("FRIDA_VISUAL.execution_legality.forbidden_repository_scope must equal 'frida_repo'.");
    }
    if (legality.required_contract_root !== '.frida/inbox/app-contract/contract.index.yaml') {
      issues.push("FRIDA_VISUAL.execution_legality.required_contract_root must equal '.frida/inbox/app-contract/contract.index.yaml'.");
    }
    if (
      typeof legality?.target_repo_rule !== 'string' ||
      !legality.target_repo_rule.includes('legal only inside a target application repository')
    ) {
      issues.push('FRIDA_VISUAL.execution_legality.target_repo_rule must confine visualizer legality to target application repositories.');
    }
    if (
      typeof legality?.frida_repo_rule !== 'string' ||
      !legality.frida_repo_rule.includes('MUST NOT be treated as a legal visualizer generation or execution environment')
    ) {
      issues.push('FRIDA_VISUAL.execution_legality.frida_repo_rule must forbid Frida-repo visualizer generation/execution.');
    }
    if (
      typeof legality?.template_seed_rule !== 'string' ||
      !legality.template_seed_rule.includes('MUST NOT be treated as a legal application contract')
    ) {
      issues.push('FRIDA_VISUAL.execution_legality.template_seed_rule must forbid treating template_app_basic as a legal app contract in repo frida.');
    }

    const forbiddenInputs = Array.isArray(legality?.forbidden_inputs) ? legality.forbidden_inputs : [];
    const requiredForbiddenInputs = new Set([
      'templates/template_app_basic/app-contract/contract.index.yaml',
      'templates/tooling/verify/fixtures/visual-overlay/**',
      'contract/** in repo frida',
    ]);
    for (const requiredInput of requiredForbiddenInputs) {
      if (!forbiddenInputs.includes(requiredInput)) {
        issues.push(`FRIDA_VISUAL.execution_legality.forbidden_inputs is missing ${requiredInput}.`);
      }
    }
    if (!forbiddenInputs.includes('core-contract/**') && !forbiddenInputs.includes('contract/**')) {
      issues.push('FRIDA_VISUAL.execution_legality.forbidden_inputs must forbid the Frida contract source/public surfaces.');
    }
  }

  const bootstrap = visual.bootstrap_relation;
  if (!isObjectLike(bootstrap)) {
    issues.push('FRIDA_VISUAL.bootstrap_relation is missing or invalid.');
  } else {
    const zeroStartOrder = Array.isArray(bootstrap?.zero_start_order) ? bootstrap.zero_start_order : [];
    const expectedZeroStartOrder = [
      'zero-start seeds the derivative app contract into the target repository first',
      'only after that seeded contract exists does visualizer invocation become legal in that target repository',
    ];
    if (JSON.stringify(zeroStartOrder) !== JSON.stringify(expectedZeroStartOrder)) {
      issues.push('FRIDA_VISUAL.bootstrap_relation.zero_start_order must preserve seed-first then visualizer-legality ordering.');
    }
    if (
      typeof bootstrap?.zero_start_auto_run_rule !== 'string' ||
      !bootstrap.zero_start_auto_run_rule.includes('MUST NOT generate or run the visualizer automatically')
    ) {
      issues.push('FRIDA_VISUAL.bootstrap_relation.zero_start_auto_run_rule must forbid automatic visualizer execution.');
    }
    if (
      typeof bootstrap?.legality_transition_rule !== 'string' ||
      !bootstrap.legality_transition_rule.includes('not itself a visualizer execution path')
    ) {
      issues.push('FRIDA_VISUAL.bootstrap_relation.legality_transition_rule must keep zero-start as enable-only.');
    }
  }
}

function assertOverlayAuthorityModel(contract, issues) {
  const visual = contract.FRIDA_VISUAL;
  if (!isObjectLike(visual)) {
    return;
  }

  const authorityChain = visual.authority_chain;
  if (!isObjectLike(authorityChain)) {
    issues.push('FRIDA_VISUAL.authority_chain is missing or invalid.');
  } else {
    const expectedRefs = {
      source_to_overlay_projection: 'FRIDA_VISUAL.component_projection',
      overlay_entity_model: 'FRIDA_VISUAL.overlay_entity_model_v1',
      overlay_schema_delivery: 'FRIDA_VISUAL.overlay_schema_v1',
      runtime_viewer_contract: 'FRIDA_VISUAL.viewer_runtime_v1',
      reference_viewer_scope: 'FRIDA_VISUAL.reference_viewer',
    };

    for (const [key, expectedRef] of Object.entries(expectedRefs)) {
      if (authorityChain?.[key]?.authorityRef !== expectedRef) {
        issues.push(`FRIDA_VISUAL.authority_chain.${key}.authorityRef must equal ${expectedRef}.`);
      }
    }

    const sourceAuthorityRef = authorityChain?.source_contract_semantics?.authorityRef;
    if (
      sourceAuthorityRef !== undefined &&
      sourceAuthorityRef !== 'FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.component_contract_spec'
    ) {
      issues.push('FRIDA_VISUAL.authority_chain.source_contract_semantics.authorityRef must equal FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT.component_contract_spec when published.');
    }

    if (
      typeof authorityChain?.rule !== 'string' ||
      !authorityChain.rule.includes('source contract semantics -> derived overlay semantics -> runtime/viewer contract') ||
      !authorityChain.rule.includes('legality remains target-repo-only')
    ) {
      issues.push('FRIDA_VISUAL.authority_chain.rule must preserve the source -> overlay -> runtime/viewer authority flow and target-repo-only legality.');
    }
  }

  const overlayModel = visual.overlay_entity_model_v1;
  if (!isObjectLike(overlayModel)) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1 is missing or invalid.');
    return;
  }

  if (overlayModel.id !== 'frida-visual-overlay-entity-model') {
    issues.push("FRIDA_VISUAL.overlay_entity_model_v1.id must equal 'frida-visual-overlay-entity-model'.");
  }
  if (overlayModel.version !== '1.0.0') {
    issues.push("FRIDA_VISUAL.overlay_entity_model_v1.version must equal '1.0.0'.");
  }
  if (overlayModel.projection_authorityRef !== 'FRIDA_VISUAL.component_projection') {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.projection_authorityRef must equal FRIDA_VISUAL.component_projection.');
  }
  if (overlayModel.runtime_authorityRef !== 'FRIDA_VISUAL.viewer_runtime_v1') {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.runtime_authorityRef must equal FRIDA_VISUAL.viewer_runtime_v1.');
  }
  if (
    typeof overlayModel?.checkability_rule !== 'string' ||
    !overlayModel.checkability_rule.includes('normatively declared here')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.checkability_rule must require runtime/viewer references to use declared overlay entity families only.');
  }

  const entityFamilies = overlayModel.entity_families;
  const expectedFamilies = [
    'projection_units',
    'component_boundaries',
    'boundary_relations',
    'entry_points',
    'exit_points',
    'mounted_child_relations',
    'continuation_mappings',
    'return_mappings',
    'topology_nodes',
    'topology_edges',
    'flow_nodes',
    'flow_edges',
    'specification_nodes',
    'specification_edges',
    'dependency_edges',
    'context_shell_hints',
    'trace_projection_hints',
  ];

  for (const family of expectedFamilies) {
    if (!isObjectLike(entityFamilies?.[family])) {
      issues.push(`FRIDA_VISUAL.overlay_entity_model_v1.entity_families.${family} is missing or invalid.`);
    }
  }

  const boundaryRelations = entityFamilies?.boundary_relations;
  if (
    !Array.isArray(boundaryRelations?.required_fields) ||
    !boundaryRelations.required_fields.includes('relation_kind') ||
    !boundaryRelations.required_fields.includes('relation_ref')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.entity_families.boundary_relations.required_fields must include relation_kind and relation_ref.');
  }
  if (
    typeof boundaryRelations?.carrier_rule !== 'string' ||
    !boundaryRelations.carrier_rule.includes('mounted_child_relations') ||
    !boundaryRelations.carrier_rule.includes('continuation_mappings') ||
    !boundaryRelations.carrier_rule.includes('return_mappings')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.entity_families.boundary_relations.carrier_rule must preserve typed relation carriers.');
  }

  const relationPrecedence = overlayModel.relation_precedence;
  if (
    typeof relationPrecedence?.mounted_child_first !== 'string' ||
    !relationPrecedence.mounted_child_first.includes('mounted_child_relations')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.relation_precedence.mounted_child_first must materialize mounted_child_relations first.');
  }
  if (
    typeof relationPrecedence?.continuation_first !== 'string' ||
    !relationPrecedence.continuation_first.includes('continuation_mappings')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.relation_precedence.continuation_first must materialize continuation_mappings first.');
  }
  if (
    typeof relationPrecedence?.return_first !== 'string' ||
    !relationPrecedence.return_first.includes('return_mappings')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.relation_precedence.return_first must materialize return_mappings first.');
  }
  if (
    typeof relationPrecedence?.generic_edge_rule !== 'string' ||
    !relationPrecedence.generic_edge_rule.includes('MUST NOT become the sole carrier')
  ) {
    issues.push('FRIDA_VISUAL.overlay_entity_model_v1.relation_precedence.generic_edge_rule must forbid typed semantics from collapsing into generic edges.');
  }

  const referenceViewer = visual.reference_viewer;
  if (!isObjectLike(referenceViewer)) {
    issues.push('FRIDA_VISUAL.reference_viewer is missing or invalid.');
  } else {
    if (referenceViewer.overlay_delivery_authorityRef !== 'FRIDA_VISUAL.overlay_schema_v1') {
      issues.push('FRIDA_VISUAL.reference_viewer.overlay_delivery_authorityRef must equal FRIDA_VISUAL.overlay_schema_v1.');
    }
    if (referenceViewer.runtime_contract_ref !== 'FRIDA_VISUAL.viewer_runtime_v1') {
      issues.push('FRIDA_VISUAL.reference_viewer.runtime_contract_ref must equal FRIDA_VISUAL.viewer_runtime_v1.');
    }
    if (referenceViewer.target_function_ref !== 'FRIDA_VISUAL.target_function') {
      issues.push('FRIDA_VISUAL.reference_viewer.target_function_ref must equal FRIDA_VISUAL.target_function.');
    }
    if (referenceViewer.execution_legality_ref !== 'FRIDA_VISUAL.execution_legality') {
      issues.push('FRIDA_VISUAL.reference_viewer.execution_legality_ref must equal FRIDA_VISUAL.execution_legality.');
    }
    if (referenceViewer.bootstrap_relation_ref !== 'FRIDA_VISUAL.bootstrap_relation') {
      issues.push('FRIDA_VISUAL.reference_viewer.bootstrap_relation_ref must equal FRIDA_VISUAL.bootstrap_relation.');
    }
    if (
      Object.prototype.hasOwnProperty.call(referenceViewer, 'fixture_marker_field') ||
      Object.prototype.hasOwnProperty.call(referenceViewer, 'fixture_rule') ||
      Object.prototype.hasOwnProperty.call(referenceViewer, 'demo_overlay')
    ) {
      issues.push('FRIDA_VISUAL.reference_viewer must not expose fixture/demo fields.');
    }
    if (
      typeof referenceViewer?.authority_rule !== 'string' ||
      !referenceViewer.authority_rule.includes('visualizer delivery metadata') ||
      !referenceViewer.authority_rule.includes('legality') ||
      !referenceViewer.authority_rule.includes('bootstrap semantics')
    ) {
      issues.push('FRIDA_VISUAL.reference_viewer.authority_rule must limit the block to delivery metadata and forbid redefining legality/bootstrap semantics.');
    }
    if (referenceViewer.module_rootDirRef !== 'PATHS.tooling.visualizerDir') {
      issues.push('FRIDA_VISUAL.reference_viewer.module_rootDirRef must equal PATHS.tooling.visualizerDir.');
    }
    if (referenceViewer.cli_entrypoint !== 'frida-core visualizer') {
      issues.push("FRIDA_VISUAL.reference_viewer.cli_entrypoint must equal 'frida-core visualizer'.");
    }
    if (referenceViewer.browser_runtime_entrypoint !== 'templates/tooling/visualizer/src/visual-reference-viewer-app.ts') {
      issues.push('FRIDA_VISUAL.reference_viewer.browser_runtime_entrypoint must equal templates/tooling/visualizer/src/visual-reference-viewer-app.ts.');
    }
    if (
      typeof referenceViewer?.output_rule !== 'string' ||
      !referenceViewer.output_rule.includes('interactive diagram')
    ) {
      issues.push('FRIDA_VISUAL.reference_viewer.output_rule must require an interactive diagram as the primary output.');
    }
    if (
      typeof referenceViewer?.frida_repo_rule !== 'string' ||
      !referenceViewer.frida_repo_rule.includes('not a legal visualizer execution surface')
    ) {
      issues.push('FRIDA_VISUAL.reference_viewer.frida_repo_rule must forbid Frida-repo execution.');
    }
    if (
      typeof referenceViewer?.target_repo_rule !== 'string' ||
      !referenceViewer.target_repo_rule.includes('legal only in a target repository')
    ) {
      issues.push('FRIDA_VISUAL.reference_viewer.target_repo_rule must confine execution to legal target repositories.');
    }
    if (
      typeof referenceViewer?.template_contract_rule !== 'string' ||
      !referenceViewer.template_contract_rule.includes('not a legal app-contract input')
    ) {
      issues.push('FRIDA_VISUAL.reference_viewer.template_contract_rule must forbid template-app visualizer inputs inside repo frida.');
    }
  }
}

function assertBoundaryFirstVisualProjection(contract, issues) {
  const visual = contract.FRIDA_VISUAL;
  if (!isObjectLike(visual)) {
    return;
  }

  const projection = visual.component_projection;
  if (!isObjectLike(projection)) {
    issues.push('FRIDA_VISUAL.component_projection is missing or invalid.');
    return;
  }

  const overlaySchema = visual.overlay_schema_v1;
  if (!isObjectLike(overlaySchema)) {
    issues.push('FRIDA_VISUAL.overlay_schema_v1 is missing or invalid.');
  } else {
    if (overlaySchema.id !== 'frida-visual-overlay') {
      issues.push("FRIDA_VISUAL.overlay_schema_v1.id must equal 'frida-visual-overlay'.");
    }
    if (overlaySchema.version !== '1.0.0') {
      issues.push("FRIDA_VISUAL.overlay_schema_v1.version must equal '1.0.0'.");
    }
    if (overlaySchema.output_pathRef !== 'PATHS.visual.overlayFile') {
      issues.push('FRIDA_VISUAL.overlay_schema_v1.output_pathRef must equal PATHS.visual.overlayFile.');
    }
    if (overlaySchema.projection_authorityRef !== 'FRIDA_VISUAL.component_projection') {
      issues.push('FRIDA_VISUAL.overlay_schema_v1.projection_authorityRef must equal FRIDA_VISUAL.component_projection.');
    }
    if (overlaySchema.entity_model_authorityRef !== 'FRIDA_VISUAL.overlay_entity_model_v1') {
      issues.push('FRIDA_VISUAL.overlay_schema_v1.entity_model_authorityRef must equal FRIDA_VISUAL.overlay_entity_model_v1.');
    }
    if (overlaySchema.builder_entrypoint !== 'src/visual.ts') {
      issues.push('FRIDA_VISUAL.overlay_schema_v1.builder_entrypoint must equal src/visual.ts.');
    }
    if (
      typeof overlaySchema?.authority_rule !== 'string' ||
      !overlaySchema.authority_rule.includes('overlay serialization')
    ) {
      issues.push('FRIDA_VISUAL.overlay_schema_v1.authority_rule must limit the block to overlay serialization concerns.');
    }
  }

  if (projection.primary_unit !== 'component-level contract file') {
    issues.push('FRIDA_VISUAL.component_projection.primary_unit must equal "component-level contract file".');
  }

  if (
    typeof projection?.authoritative_rule !== 'string' ||
    !projection.authoritative_rule.includes('authoritative source')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.authoritative_rule must declare projection authority.');
  }

  const projectionDomains = projection?.projection_domains;
  for (const domain of ['topology', 'flow', 'specification']) {
    if (!isObjectLike(projectionDomains?.[domain])) {
      issues.push(`FRIDA_VISUAL.component_projection.projection_domains.${domain} is missing or invalid.`);
    }
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
    issues.push('FRIDA_VISUAL.component_projection.current_boundary_establishment.order must match the canonical component boundary establishment order.');
  }

  if (
    typeof projection?.current_boundary_establishment?.rule !== 'string' ||
    !projection.current_boundary_establishment.rule.includes('YAML depth may expand detail only after the current component boundary is established')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.current_boundary_establishment.rule must keep YAML depth secondary to boundary establishment.');
  }

  if (projection?.drill_in?.source_field !== 'component_mount_point.mounted_child_boundaryRefs') {
    issues.push('FRIDA_VISUAL.component_projection.drill_in.source_field must point to component_mount_point.mounted_child_boundaryRefs.');
  }

  if (
    typeof projection?.drill_in?.parent_view_rule !== 'string' ||
    !projection.drill_in.parent_view_rule.includes('MUST NOT auto-expand mounted child internals')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.drill_in.parent_view_rule must forbid auto-expanding mounted child internals.');
  }

  const drillOutFields = Array.isArray(projection?.drill_out?.source_fields)
    ? projection.drill_out.source_fields
    : [];
  for (const requiredField of [
    'component_output_interface.outcome',
    'component_output_interface.target_boundaryRef',
    'component_output_interface.return_target_boundaryRef',
  ]) {
    if (!drillOutFields.includes(requiredField)) {
      issues.push(`FRIDA_VISUAL.component_projection.drill_out.source_fields missing ${requiredField}.`);
    }
  }

  if (
    typeof projection?.drill_out?.rule !== 'string' ||
    !projection.drill_out.rule.includes('component_output_interface exit entries')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.drill_out.rule must source return and continuation targeting from component_output_interface exit entries.');
  }

  if (
    typeof projection?.dependency_projection?.rule !== 'string' ||
    !projection.dependency_projection.rule.includes('component_shared_refs create dependency edges only')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.dependency_projection.rule must keep component_shared_refs dependency-only.');
  }

  const mappingRules = projection?.mapping_rules;
  for (const section of [
    'component_hierarchy_position',
    'component_mount_point',
    'component_input_interface',
    'component_output_interface',
    'component_domain_blocks',
    'component_shared_refs',
  ]) {
    if (!isObjectLike(mappingRules?.[section])) {
      issues.push(`FRIDA_VISUAL.component_projection.mapping_rules.${section} is missing or invalid.`);
    }
  }

  if (
    typeof mappingRules?.component_domain_blocks?.forbidden_rule !== 'string' ||
    !mappingRules.component_domain_blocks.forbidden_rule.includes('MUST NOT be promoted')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.mapping_rules.component_domain_blocks.forbidden_rule must forbid heuristic promotion.');
  }

  if (projection?.entry_semantics?.source_section !== 'component_mount_point') {
    issues.push('FRIDA_VISUAL.component_projection.entry_semantics.source_section must equal component_mount_point.');
  }

  if (projection?.exit_semantics?.source_section !== 'component_output_interface') {
    issues.push('FRIDA_VISUAL.component_projection.exit_semantics.source_section must equal component_output_interface.');
  }

  const allowedOutcomes = Array.isArray(projection?.exit_semantics?.allowed_outcomes)
    ? projection.exit_semantics.allowed_outcomes
    : [];
  if (JSON.stringify(allowedOutcomes) !== JSON.stringify(['continue', 'return', 'exit'])) {
    issues.push('FRIDA_VISUAL.component_projection.exit_semantics.allowed_outcomes must equal [continue, return, exit].');
  }

  if (projection?.mounted_child_semantics?.source_field !== 'component_mount_point.mounted_child_boundaryRefs') {
    issues.push('FRIDA_VISUAL.component_projection.mounted_child_semantics.source_field must equal component_mount_point.mounted_child_boundaryRefs.');
  }

  if (
    typeof projection?.mounted_child_semantics?.non_auto_expand_rule !== 'string' ||
    !projection.mounted_child_semantics.non_auto_expand_rule.includes('no mounted child boundary is projected')
  ) {
    issues.push('FRIDA_VISUAL.component_projection.mounted_child_semantics.non_auto_expand_rule must define the child non-auto-expansion rule.');
  }

  if (projection?.continuation_return_semantics?.source_fields?.continuation !== 'component_output_interface.target_boundaryRef') {
    issues.push('FRIDA_VISUAL.component_projection.continuation_return_semantics.source_fields.continuation must equal component_output_interface.target_boundaryRef.');
  }

  if (projection?.continuation_return_semantics?.source_fields?.return !== 'component_output_interface.return_target_boundaryRef') {
    issues.push('FRIDA_VISUAL.component_projection.continuation_return_semantics.source_fields.return must equal component_output_interface.return_target_boundaryRef.');
  }

  const domainBlockRouting = projection?.component_domain_block_routing;
  if (!isObjectLike(domainBlockRouting)) {
    issues.push('FRIDA_VISUAL.component_projection.component_domain_block_routing is missing or invalid.');
  } else {
    if (domainBlockRouting.selector_field !== 'projection_domains') {
      issues.push('FRIDA_VISUAL.component_projection.component_domain_block_routing.selector_field must equal projection_domains.');
    }
    const selectorValues = Array.isArray(domainBlockRouting.selector_allowed_values)
      ? domainBlockRouting.selector_allowed_values
      : [];
    if (JSON.stringify(selectorValues) !== JSON.stringify(['topology', 'flow', 'specification'])) {
      issues.push('FRIDA_VISUAL.component_projection.component_domain_block_routing.selector_allowed_values must equal [topology, flow, specification].');
    }
    if (
      typeof domainBlockRouting?.authoritative_rule !== 'string' ||
      !domainBlockRouting.authoritative_rule.includes('selector-driven only')
    ) {
      issues.push('FRIDA_VISUAL.component_projection.component_domain_block_routing.authoritative_rule must require selector-driven routing.');
    }
    if (
      typeof domainBlockRouting?.forbidden_without_selector !== 'string' ||
      !domainBlockRouting.forbidden_without_selector.includes('MUST NOT produce topology nodes')
    ) {
      issues.push('FRIDA_VISUAL.component_projection.component_domain_block_routing.forbidden_without_selector must keep selector-less blocks out of topology/flow/expanded specification.');
    }
    if (
      typeof domainBlockRouting?.fallback_rule !== 'string' ||
      !domainBlockRouting.fallback_rule.includes('collapsed specification-local declaration anchor')
    ) {
      issues.push('FRIDA_VISUAL.component_projection.component_domain_block_routing.fallback_rule must keep selector-less blocks collapsed.');
    }
  }

  const principles = new Map(
    Array.isArray(visual.principles)
      ? visual.principles
          .filter((entry) => isObjectLike(entry) && typeof entry.id === 'string' && typeof entry.text === 'string')
          .map((entry) => [entry.id, entry.text])
      : [],
  );

  const primaryRule = principles.get('component_boundary_semantics_primary');
  if (
    typeof primaryRule !== 'string' ||
    !primaryRule.includes('YAML depth is') ||
    !primaryRule.includes('secondary')
  ) {
    issues.push('FRIDA_VISUAL.principles.component_boundary_semantics_primary must state that boundary semantics are primary and YAML depth is secondary.');
  }

  const flowCanon = principles.get('component_boundary_flow_canon');
  if (
    typeof flowCanon !== 'string' ||
    !flowCanon.includes('component_output_interface is the canonical source for exit semantics')
  ) {
    issues.push('FRIDA_VISUAL.principles.component_boundary_flow_canon must keep component_output_interface as the canonical exit source.');
  }

  const authorityPrinciple = principles.get('component_projection_authority');
  if (
    typeof authorityPrinciple !== 'string' ||
    !authorityPrinciple.includes('FRIDA_VISUAL.component_projection')
  ) {
    issues.push('FRIDA_VISUAL.principles.component_projection_authority must point to FRIDA_VISUAL.component_projection.');
  }

  const orderingPrinciple = principles.get('deterministic_projection_ordering');
  if (
    typeof orderingPrinciple !== 'string' ||
    !orderingPrinciple.includes('golden tests')
  ) {
    issues.push('FRIDA_VISUAL.principles.deterministic_projection_ordering must preserve stable ordering for golden tests.');
  }

  const sectionOrder = Array.isArray(visual?.determinism?.stable_interpretation?.section_order)
    ? visual.determinism.stable_interpretation.section_order
    : [];
  const expectedSectionOrder = [
    'component_hierarchy_position',
    'component_mount_point',
    'component_input_interface',
    'component_output_interface',
    'component_domain_blocks',
    'component_shared_refs',
  ];
  if (JSON.stringify(sectionOrder) !== JSON.stringify(expectedSectionOrder)) {
    issues.push('FRIDA_VISUAL.determinism.stable_interpretation.section_order must match the canonical component section order.');
  }

  const domainOrder = Array.isArray(visual?.determinism?.stable_interpretation?.domain_order)
    ? visual.determinism.stable_interpretation.domain_order
    : [];
  if (JSON.stringify(domainOrder) !== JSON.stringify(['topology', 'flow', 'specification'])) {
    issues.push('FRIDA_VISUAL.determinism.stable_interpretation.domain_order must equal [topology, flow, specification].');
  }

  const volatileFields = Array.isArray(visual?.determinism?.volatile_fields) ? visual.determinism.volatile_fields : [];
  if (JSON.stringify(volatileFields) !== JSON.stringify(['meta.generated_at'])) {
    issues.push("FRIDA_VISUAL.determinism.volatile_fields must equal ['meta.generated_at'].");
  }

  if (
    typeof visual?.determinism?.rule !== 'string' ||
    !visual.determinism.rule.includes('byte-identical')
  ) {
    issues.push('FRIDA_VISUAL.determinism.rule must require byte-identical output after volatile-field normalization.');
  }

  if (
    typeof visual?.determinism?.stable_identity?.node_rule !== 'string' ||
    !visual.determinism.stable_identity.node_rule.includes('canonical source paths')
  ) {
    issues.push('FRIDA_VISUAL.determinism.stable_identity.node_rule must derive node ids from canonical source paths.');
  }

  if (
    typeof visual?.determinism?.stable_sort?.edge_rule !== 'string' ||
    !visual.determinism.stable_sort.edge_rule.includes('source path')
  ) {
    issues.push('FRIDA_VISUAL.determinism.stable_sort.edge_rule must define stable edge ordering.');
  }

  const refMapping = visual.ref_to_edge_mapping;
  if (!isObjectLike(refMapping)) {
    issues.push('FRIDA_VISUAL.ref_to_edge_mapping is missing or invalid.');
  } else {
    if (
      typeof refMapping?.rule !== 'string' ||
      !refMapping.rule.includes('Typed relation families MUST be materialized before any generic edge projection')
    ) {
      issues.push('FRIDA_VISUAL.ref_to_edge_mapping.rule must give typed relations precedence over generic edges.');
    }

    const precedence = refMapping.precedence;
    const requiredPrecedence = {
      'component_mount_point.mounted_child_boundaryRefs': 'mounted_child_relations',
      'component_output_interface.target_boundaryRef': 'continuation_mappings',
      'component_output_interface.return_target_boundaryRef': 'return_mappings',
      'component_shared_refs.*Ref_or_*Refs': 'dependency_edges',
    };

    for (const [key, expectedFragment] of Object.entries(requiredPrecedence)) {
      if (typeof precedence?.[key] !== 'string' || !precedence[key].includes(expectedFragment)) {
        issues.push(`FRIDA_VISUAL.ref_to_edge_mapping.precedence.${key} must mention ${expectedFragment}.`);
      }
    }

    if (
      typeof refMapping?.generic_edge_rule !== 'string' ||
      !refMapping.generic_edge_rule.includes('MUST NOT become the sole carrier')
    ) {
      issues.push('FRIDA_VISUAL.ref_to_edge_mapping.generic_edge_rule must forbid generic edges from erasing typed semantics.');
    }
  }
}

function assertViewerRuntimeContract(contract, issues) {
  const visual = contract.FRIDA_VISUAL;
  if (!isObjectLike(visual)) {
    return;
  }

  const viewer = visual.viewer_runtime_v1;
  if (!isObjectLike(viewer)) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1 is missing or invalid.');
    return;
  }

  if (viewer.id !== 'frida-visual-viewer-runtime') {
    issues.push("FRIDA_VISUAL.viewer_runtime_v1.id must equal 'frida-visual-viewer-runtime'.");
  }
  if (viewer.version !== '1.0.0') {
    issues.push("FRIDA_VISUAL.viewer_runtime_v1.version must equal '1.0.0'.");
  }
  if (viewer.schema_file !== 'schemas/frida-visual-viewer-runtime.schema.json') {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.schema_file must equal schemas/frida-visual-viewer-runtime.schema.json.');
  }
  if (viewer.runtime_entrypoint !== 'templates/tooling/visualizer/src/visual-viewer.ts') {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.runtime_entrypoint must equal templates/tooling/visualizer/src/visual-viewer.ts.');
  }
  if (viewer.overlay_input_ref !== 'FRIDA_VISUAL.overlay_schema_v1') {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.overlay_input_ref must equal FRIDA_VISUAL.overlay_schema_v1.');
  }
  if (viewer.overlay_entity_model_authorityRef !== 'FRIDA_VISUAL.overlay_entity_model_v1') {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.overlay_entity_model_authorityRef must equal FRIDA_VISUAL.overlay_entity_model_v1.');
  }

  const sourceVocabulary = Array.isArray(viewer?.vocabulary_separation?.source_contract_vocabulary)
    ? viewer.vocabulary_separation.source_contract_vocabulary
    : [];
  const overlayVocabulary = Array.isArray(viewer?.vocabulary_separation?.overlay_vocabulary)
    ? viewer.vocabulary_separation.overlay_vocabulary
    : [];
  const runtimeVocabulary = Array.isArray(viewer?.vocabulary_separation?.runtime_vocabulary)
    ? viewer.vocabulary_separation.runtime_vocabulary
    : [];

  const expectedSourceVocabulary = [
    'component_hierarchy_position',
    'component_mount_point',
    'component_input_interface',
    'component_output_interface',
    'component_domain_blocks',
    'component_shared_refs',
  ];
  const expectedOverlayVocabulary = [
    'projection_units',
    'component_boundaries',
    'boundary_relations',
    'entry_points',
    'exit_points',
    'mounted_child_relations',
    'continuation_mappings',
    'return_mappings',
    'topology_nodes',
    'topology_edges',
    'flow_nodes',
    'flow_edges',
    'specification_nodes',
    'specification_edges',
    'dependency_edges',
    'context_shell_hints',
    'trace_projection_hints',
  ];
  const expectedRuntimeVocabulary = [
    'scope',
    'focus',
    'lod',
    'context_shell',
    'enter',
    'peek',
    'back',
    'up',
    'trace',
    'navigation_stack',
  ];

  if (JSON.stringify(sourceVocabulary) !== JSON.stringify(expectedSourceVocabulary)) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.vocabulary_separation.source_contract_vocabulary is invalid.');
  }
  if (JSON.stringify(overlayVocabulary) !== JSON.stringify(expectedOverlayVocabulary)) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.vocabulary_separation.overlay_vocabulary is invalid.');
  }
  if (JSON.stringify(runtimeVocabulary) !== JSON.stringify(expectedRuntimeVocabulary)) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.vocabulary_separation.runtime_vocabulary is invalid.');
  }

  if (
    typeof viewer?.vocabulary_separation?.rule !== 'string' ||
    !viewer.vocabulary_separation.rule.includes('MUST use runtime vocabulary')
  ) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.vocabulary_separation.rule must enforce source/overlay/runtime separation.');
  }

  const consumedEntities = viewer.consumed_overlay_entities;
  const expectedConsumedGroups = ['scope_records', 'navigation_relations', 'lod_projections', 'shell_and_trace'];
  for (const key of expectedConsumedGroups) {
    if (!isObjectLike(consumedEntities) || !(key in consumedEntities)) {
      issues.push(`FRIDA_VISUAL.viewer_runtime_v1.consumed_overlay_entities.${key} is missing.`);
    }
  }

  const runtimeVocabularyMap = viewer.runtime_vocabulary;
  for (const key of expectedRuntimeVocabulary) {
    if (typeof runtimeVocabularyMap?.[key] !== 'string' || !runtimeVocabularyMap[key].trim()) {
      issues.push(`FRIDA_VISUAL.viewer_runtime_v1.runtime_vocabulary.${key} must be a non-empty string.`);
    }
  }

  const stateModel = viewer.state_model;
  for (const key of ['current_scope', 'current_lod', 'focus', 'context_shell', 'peek_state', 'navigation_stack', 'trace_state']) {
    if (typeof stateModel?.[key] !== 'string' || !stateModel[key].trim()) {
      issues.push(`FRIDA_VISUAL.viewer_runtime_v1.state_model.${key} must be a non-empty string.`);
    }
  }

  const actions = viewer.actions;
  for (const key of ['enter', 'peek', 'up', 'back', 'change_lod', 'set_focus', 'open_trace', 'close_trace', 'center_on_entry', 'center_on_exit']) {
    if (typeof actions?.[key]?.rule !== 'string' || !actions[key].rule.trim()) {
      issues.push(`FRIDA_VISUAL.viewer_runtime_v1.actions.${key}.rule must be a non-empty string.`);
    }
  }

  if (
    typeof viewer?.authority_rule !== 'string' ||
    !viewer.authority_rule.includes('FRIDA_VISUAL.target_function') ||
    !viewer.authority_rule.includes('FRIDA_VISUAL.execution_legality') ||
    !viewer.authority_rule.includes('FRIDA_VISUAL.bootstrap_relation')
  ) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.authority_rule must remain subordinate to target_function, execution_legality, and bootstrap_relation.');
  }

  if (
    typeof viewer?.actions?.peek?.rule !== 'string' ||
    !viewer.actions.peek.rule.includes('MUST NOT mutate current scope')
  ) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.actions.peek.rule must keep peek out of current scope mutation.');
  }
  if (
    typeof viewer?.actions?.open_trace?.rule !== 'string' ||
    !viewer.actions.open_trace.rule.includes('independent from LOD')
  ) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.actions.open_trace.rule must keep trace separate from LOD.');
  }

  const consumptionRules = viewer.consumption_rules;
  if (
    typeof consumptionRules?.data_source_rule !== 'string' ||
    !consumptionRules.data_source_rule.includes('sole runtime semantic source')
  ) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.consumption_rules.data_source_rule must require overlay-only runtime semantics.');
  }
  if (
    typeof consumptionRules?.mounted_child_rule !== 'string' ||
    !consumptionRules.mounted_child_rule.includes('MUST NOT auto-expand child internals')
  ) {
    issues.push('FRIDA_VISUAL.viewer_runtime_v1.consumption_rules.mounted_child_rule must forbid child auto-expansion.');
  }

  const contextShellRules = viewer.context_shell_rules;
  for (const key of ['caller_entry', 'public_exits', 'continuation_return_hints', 'current_position', 'minimap_hooks']) {
    if (typeof contextShellRules?.[key] !== 'string' || !contextShellRules[key].trim()) {
      issues.push(`FRIDA_VISUAL.viewer_runtime_v1.context_shell_rules.${key} must be a non-empty string.`);
    }
  }
}

function main() {
  console.log('🔍 Checking visual contract consistency...');
  const { contract } = loadContract();
  const issues = [];

  assertVisualContracts(contract, issues);
  assertVisualPaths(contract, issues);
  assertVisualizerGovernanceContract(contract, issues);
  assertOverlayAuthorityModel(contract, issues);
  assertBoundaryFirstVisualProjection(contract, issues);
  assertViewerRuntimeContract(contract, issues);

  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    fail(`Visual contract consistency FAILED with ${issues.length} issue(s).`);
  }

  console.log('✅ Visual contract consistency OK');
}

try {
  main();
} catch (error) {
  fail(`check-visual-contract-consistency failed: ${error instanceof Error ? error.message : String(error)}`);
}
