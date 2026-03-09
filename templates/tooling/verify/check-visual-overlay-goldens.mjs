#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import yaml from 'yaml';

const ROOT_DIR = path.resolve(process.cwd());
const FIXTURE_DIR = path.join(ROOT_DIR, 'templates', 'tooling', 'verify', 'fixtures', 'visual-overlay');
const MANIFEST_FILE = path.join(FIXTURE_DIR, 'manifest.json');
const SCHEMA_FILE = path.join(ROOT_DIR, 'schemas', 'frida-visual-overlay.schema.json');
const FIXED_TIMESTAMP = '1970-01-01T00:00:00.000Z';

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYaml(filePath) {
  return yaml.parse(fs.readFileSync(filePath, 'utf8'));
}

function isObjectLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

function sortById(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function sortNodes(items) {
  return [...items].sort((a, b) => {
    if ((a.boundary_id || '') !== (b.boundary_id || '')) {
      return (a.boundary_id || '').localeCompare(b.boundary_id || '');
    }
    if (a.order_index !== b.order_index) {
      return a.order_index - b.order_index;
    }
    return a.id.localeCompare(b.id);
  });
}

function sortEdges(items) {
  return [...items].sort((a, b) => {
    if ((a.source_boundary_id || '') !== (b.source_boundary_id || '')) {
      return (a.source_boundary_id || '').localeCompare(b.source_boundary_id || '');
    }
    if (a.order_index !== b.order_index) {
      return a.order_index - b.order_index;
    }
    return a.id.localeCompare(b.id);
  });
}

function assertSortedOverlay(overlay, fixtureId) {
  const sortChecks = [
    ['projection_units', overlay.projection_units, sortById],
    ['component_boundaries', overlay.component_boundaries, sortById],
    ['topology_nodes', overlay.topology_nodes, sortNodes],
    ['topology_edges', overlay.topology_edges, sortEdges],
    ['flow_nodes', overlay.flow_nodes, sortNodes],
    ['flow_edges', overlay.flow_edges, sortEdges],
    ['specification_nodes', overlay.specification_nodes, sortNodes],
    ['specification_edges', overlay.specification_edges, sortEdges],
    ['entry_points', overlay.entry_points, sortById],
    ['exit_points', overlay.exit_points, sortById],
    ['mounted_child_relations', overlay.mounted_child_relations, sortById],
    ['continuation_mappings', overlay.continuation_mappings, sortById],
    ['return_mappings', overlay.return_mappings, sortById],
    ['dependency_edges', overlay.dependency_edges, sortById],
    ['context_shell_hints', overlay.context_shell_hints, sortById],
    ['trace_projection_hints', overlay.trace_projection_hints, sortById],
  ];

  for (const [label, items, sorter] of sortChecks) {
    const expected = sorter(items);
    if (JSON.stringify(items) !== JSON.stringify(expected)) {
      fail(`Fixture '${fixtureId}' emitted non-stable ordering in ${label}.`);
    }
  }
}

function assertOverlayInvariants(overlay, fixtureId) {
  const boundaryIds = new Set(overlay.component_boundaries.map((entry) => entry.boundary_id));
  const topologyEdgeIds = new Set(overlay.topology_edges.map((entry) => entry.id));
  const flowEdgeIds = new Set(overlay.flow_edges.map((entry) => entry.id));
  const flowNodeIds = new Set(overlay.flow_nodes.map((entry) => entry.id));
  const exitPointIds = new Set(overlay.exit_points.map((entry) => entry.id));
  const dependencyTargetNodeIds = new Set(
    overlay.specification_nodes.filter((entry) => entry.kind === 'dependency_target').map((entry) => entry.id)
  );

  for (const boundary of overlay.component_boundaries) {
    for (const exitPointId of boundary.exit_point_ids) {
      if (!exitPointIds.has(exitPointId)) {
        fail(`Fixture '${fixtureId}' references missing exit point '${exitPointId}' from boundary '${boundary.boundary_id}'.`);
      }
    }
  }

  for (const relation of overlay.mounted_child_relations) {
    if (!boundaryIds.has(relation.parent_boundary_id) || !boundaryIds.has(relation.child_boundary_id)) {
      fail(`Fixture '${fixtureId}' has mounted child relation '${relation.id}' with unresolved boundary ids.`);
    }
    if (!topologyEdgeIds.has(relation.topology_edge_id)) {
      fail(`Fixture '${fixtureId}' has mounted child relation '${relation.id}' with missing topology edge '${relation.topology_edge_id}'.`);
    }
  }

  for (const mapping of [...overlay.continuation_mappings, ...overlay.return_mappings]) {
    if (!exitPointIds.has(mapping.source_exit_point_id)) {
      fail(`Fixture '${fixtureId}' has mapping '${mapping.id}' with unresolved source exit point '${mapping.source_exit_point_id}'.`);
    }
    if (!boundaryIds.has(mapping.source_boundary_id) || !boundaryIds.has(mapping.target_boundary_id)) {
      fail(`Fixture '${fixtureId}' has mapping '${mapping.id}' with unresolved boundary ids.`);
    }
    if (!flowEdgeIds.has(mapping.flow_edge_id)) {
      fail(`Fixture '${fixtureId}' has mapping '${mapping.id}' with missing flow edge '${mapping.flow_edge_id}'.`);
    }
  }

  for (const exitPoint of overlay.exit_points) {
    if (!flowNodeIds.has(exitPoint.flow_node_id)) {
      fail(`Fixture '${fixtureId}' has exit point '${exitPoint.id}' with missing flow node '${exitPoint.flow_node_id}'.`);
    }
  }

  for (const entryPoint of overlay.entry_points) {
    if (!flowNodeIds.has(entryPoint.flow_node_id)) {
      fail(`Fixture '${fixtureId}' has entry point '${entryPoint.id}' with missing flow node '${entryPoint.flow_node_id}'.`);
    }
  }

  for (const dependencyEdge of overlay.dependency_edges) {
    if (!boundaryIds.has(dependencyEdge.source_boundary_id)) {
      fail(`Fixture '${fixtureId}' has dependency edge '${dependencyEdge.id}' with unresolved source boundary '${dependencyEdge.source_boundary_id}'.`);
    }
    if (!dependencyTargetNodeIds.has(dependencyEdge.target_node_id)) {
      fail(`Fixture '${fixtureId}' has dependency edge '${dependencyEdge.id}' with missing dependency target node '${dependencyEdge.target_node_id}'.`);
    }
  }
}

function assertOverlayVocabulary(overlay, fixtureId) {
  const forbiddenKinds = new Set([
    'input_interface',
    'entry_to_input',
    'input_to_domain_block',
    'input_to_exit',
  ]);

  for (const node of [...overlay.topology_nodes, ...overlay.flow_nodes, ...overlay.specification_nodes]) {
    if (forbiddenKinds.has(node.kind)) {
      fail(`Fixture '${fixtureId}' emitted forbidden legacy-derived kind '${node.kind}'.`);
    }
    if (node.kind.startsWith('section:component_')) {
      fail(`Fixture '${fixtureId}' emitted source-like specification kind '${node.kind}'.`);
    }
  }

  for (const edge of [...overlay.topology_edges, ...overlay.flow_edges, ...overlay.specification_edges]) {
    if (forbiddenKinds.has(edge.kind)) {
      fail(`Fixture '${fixtureId}' emitted forbidden legacy-derived kind '${edge.kind}'.`);
    }
  }

  for (const boundary of overlay.component_boundaries) {
    for (const forbiddenKey of ['domain_block_ids', 'shared_ref_targets', 'input_interface_keys']) {
      if (Object.prototype.hasOwnProperty.call(boundary, forbiddenKey)) {
        fail(`Fixture '${fixtureId}' emitted forbidden source-like boundary field '${forbiddenKey}'.`);
      }
    }
  }
}

function assertFixtureAssertions(overlay, fixture) {
  const assertions = isObjectLike(fixture.assertions) ? fixture.assertions : {};
  const fixtureId = fixture.id;

  if (typeof assertions.projection_unit_count === 'number' && overlay.projection_units.length !== assertions.projection_unit_count) {
    fail(`Fixture '${fixtureId}' expected projection_unit_count=${assertions.projection_unit_count}, got ${overlay.projection_units.length}.`);
  }
  if (typeof assertions.component_boundary_count === 'number' && overlay.component_boundaries.length !== assertions.component_boundary_count) {
    fail(`Fixture '${fixtureId}' expected component_boundary_count=${assertions.component_boundary_count}, got ${overlay.component_boundaries.length}.`);
  }
  if (typeof assertions.dependency_edge_count === 'number' && overlay.dependency_edges.length !== assertions.dependency_edge_count) {
    fail(`Fixture '${fixtureId}' expected dependency_edge_count=${assertions.dependency_edge_count}, got ${overlay.dependency_edges.length}.`);
  }

  if (Array.isArray(assertions.source_kinds)) {
    const actual = overlay.projection_units.map((entry) => entry.source_kind);
    if (JSON.stringify(actual) !== JSON.stringify(assertions.source_kinds)) {
      fail(`Fixture '${fixtureId}' expected source_kinds=${JSON.stringify(assertions.source_kinds)}, got ${JSON.stringify(actual)}.`);
    }
  }

  if (Array.isArray(assertions.exit_points)) {
    const actual = overlay.exit_points.map((entry) => ({
      boundary_id: entry.boundary_id,
      exit_id: entry.exit_id,
      outcome: entry.outcome,
      continuation_target_boundary_id: entry.continuation_target_boundary_id,
      return_target_boundary_id: entry.return_target_boundary_id,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(assertions.exit_points)) {
      fail(`Fixture '${fixtureId}' exit_points assertion drifted.`);
    }
  }

  if (Array.isArray(assertions.continuation_mappings)) {
    const actual = overlay.continuation_mappings.map((entry) => ({
      source_boundary_id: entry.source_boundary_id,
      target_boundary_id: entry.target_boundary_id,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(assertions.continuation_mappings)) {
      fail(`Fixture '${fixtureId}' continuation_mappings assertion drifted.`);
    }
  }

  if (Array.isArray(assertions.return_mappings)) {
    const actual = overlay.return_mappings.map((entry) => ({
      source_boundary_id: entry.source_boundary_id,
      target_boundary_id: entry.target_boundary_id,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(assertions.return_mappings)) {
      fail(`Fixture '${fixtureId}' return_mappings assertion drifted.`);
    }
  }

  if (Array.isArray(assertions.mounted_child_relations)) {
    const actual = overlay.mounted_child_relations.map((entry) => ({
      parent_boundary_id: entry.parent_boundary_id,
      child_boundary_id: entry.child_boundary_id,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(assertions.mounted_child_relations)) {
      fail(`Fixture '${fixtureId}' mounted_child_relations assertion drifted.`);
    }
  }

  if (Array.isArray(assertions.forbidden_specification_node_ids)) {
    const present = new Set(overlay.specification_nodes.map((entry) => entry.id));
    for (const nodeId of assertions.forbidden_specification_node_ids) {
      if (present.has(nodeId)) {
        fail(`Fixture '${fixtureId}' emitted forbidden specification node '${nodeId}'.`);
      }
    }
  }
}

function loadContractFixture(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const contract = readYaml(filePath);
  if (!isObjectLike(contract)) {
    fail(`Fixture contract must parse to an object: ${normalizePath(filePath)}`);
  }
  return { raw, contract };
}

async function loadRuntimeCompiler() {
  const modulePath = path.join(ROOT_DIR, 'dist', 'visual.js');
  if (!fs.existsSync(modulePath)) {
    fail('Runtime visual compiler not found at dist/visual.js. Run `npm run build` first.');
  }

  const runtime = await import(pathToFileURL(modulePath).href);
  if (typeof runtime.extractVisualSchemaOverlay !== 'function' || typeof runtime.normalizeOverlayForComparison !== 'function') {
    fail('dist/visual.js does not export the required overlay compiler functions.');
  }
  return runtime;
}

function compileFixture(runtime, fixture, contractFile) {
  const { raw, contract } = loadContractFixture(contractFile);
  return runtime.extractVisualSchemaOverlay(contract, raw, {
    generatedAt: FIXED_TIMESTAMP,
    sourcePath: normalizePath(contractFile),
    outputPath: contract?.PATHS?.visual?.overlayFile,
    contractPath: contractFile,
  });
}

function compareOverlayGolden(runtime, fixture, actualOverlay, expectedFile) {
  if (!fs.existsSync(expectedFile)) {
    fail(`Expected overlay file is missing for fixture '${fixture.id}': ${normalizePath(expectedFile)}`);
  }

  const expectedOverlay = readJson(expectedFile);
  const normalizedActual = runtime.normalizeOverlayForComparison(actualOverlay);
  const normalizedExpected = runtime.normalizeOverlayForComparison(expectedOverlay);

  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    fail(
      `Fixture '${fixture.id}' overlay drift detected. Expected ${normalizePath(expectedFile)} to match runtime compiler output.`
    );
  }
}

function assertExpectedFailure(runtime, fixture, contractFile) {
  let thrown = null;
  try {
    compileFixture(runtime, fixture, contractFile);
  } catch (error) {
    thrown = error instanceof Error ? error : new Error(String(error));
  }

  if (!thrown) {
    fail(`Fixture '${fixture.id}' expected a compiler failure but the compile succeeded.`);
  }

  const expectedMessages = Array.isArray(fixture.expected_error_includes) ? fixture.expected_error_includes : [];
  for (const fragment of expectedMessages) {
    if (!thrown.message.includes(fragment)) {
      fail(
        `Fixture '${fixture.id}' failed with an unexpected message. Missing fragment '${fragment}'. Actual: ${thrown.message}`
      );
    }
  }
}

async function main() {
  console.log('🔍 Checking visual overlay golden fixtures...');

  if (!fs.existsSync(MANIFEST_FILE)) {
    fail(`Fixture manifest not found: ${normalizePath(MANIFEST_FILE)}`);
  }
  if (!fs.existsSync(SCHEMA_FILE)) {
    fail(`Overlay schema not found: ${normalizePath(SCHEMA_FILE)}`);
  }

  const manifest = readJson(MANIFEST_FILE);
  if (!Array.isArray(manifest?.fixtures) || manifest.fixtures.length === 0) {
    fail('Fixture manifest must declare a non-empty fixtures array.');
  }

  const runtime = await loadRuntimeCompiler();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateOverlay = ajv.compile(readJson(SCHEMA_FILE));

  let passCount = 0;
  let failCount = 0;

  for (const fixture of manifest.fixtures) {
    if (!isObjectLike(fixture) || typeof fixture.id !== 'string' || !fixture.id.trim()) {
      fail('Each fixture manifest entry must declare a non-empty string id.');
    }

    const contractFile = path.join(FIXTURE_DIR, fixture.contract);
    if (!fs.existsSync(contractFile)) {
      fail(`Fixture contract not found: ${normalizePath(contractFile)}`);
    }

    if (fixture.expected_status === 'fail') {
      assertExpectedFailure(runtime, fixture, contractFile);
      failCount += 1;
      continue;
    }

    const first = compileFixture(runtime, fixture, contractFile);
    const second = compileFixture(runtime, fixture, contractFile);

    if (JSON.stringify(first) !== JSON.stringify(second)) {
      fail(`Fixture '${fixture.id}' is not deterministic across repeated runtime compilation.`);
    }

    if (!validateOverlay(first)) {
      const details = (validateOverlay.errors || []).map((entry) => `${entry.instancePath || '/'} ${entry.message}`).join(' | ');
      fail(`Fixture '${fixture.id}' emitted schema-invalid overlay: ${details}`);
    }

    assertSortedOverlay(first, fixture.id);
    assertOverlayInvariants(first, fixture.id);
    assertOverlayVocabulary(first, fixture.id);
    assertFixtureAssertions(first, fixture);
    compareOverlayGolden(runtime, fixture, first, path.join(FIXTURE_DIR, fixture.expected_overlay));
    passCount += 1;
  }

  console.log(`✅ Visual overlay golden fixtures OK (pass=${passCount}, fail=${failCount})`);
}

try {
  await main();
} catch (error) {
  fail(`check-visual-overlay-goldens failed: ${error instanceof Error ? error.message : String(error)}`);
}
