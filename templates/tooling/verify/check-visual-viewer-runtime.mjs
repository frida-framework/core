#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadVisualizerModuleConfig, resolveVisualizerModuleDistFile } from '../lib/visualizer-module.mjs';

const ROOT_DIR = path.resolve(process.cwd());
const SCHEMA_FILE = path.join(ROOT_DIR, 'schemas', 'frida-visual-viewer-runtime.schema.json');
const FIXTURE_DIR = path.join(ROOT_DIR, 'templates', 'tooling', 'verify', 'fixtures', 'visual-overlay');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

async function loadRuntime() {
  const config = loadVisualizerModuleConfig();
  if (!config.enabled) {
    console.log('ℹ️ Optional visualizer module disabled; skipping viewer runtime contract check.');
    process.exit(0);
  }

  const modulePath = resolveVisualizerModuleDistFile('visual-viewer.js');
  if (!modulePath || !fs.existsSync(modulePath)) {
    fail('Viewer runtime module not found in the optional visualizer module build output. Run `npm run build` first.');
  }
  const runtime = await import(pathToFileURL(modulePath).href);
  for (const fn of ['createVisualViewerState', 'reduceVisualViewerState', 'deriveVisualViewerFrame', 'normalizeViewerStateForComparison']) {
    if (typeof runtime[fn] !== 'function') {
      fail(`Optional visualizer runtime is missing ${fn}.`);
    }
  }
  return runtime;
}

function validateState(validate, state, label) {
  if (!validate(state)) {
    const details = (validate.errors || []).map((entry) => `${entry.instancePath || '/'} ${entry.message}`).join(' | ');
    fail(`${label} is schema-invalid: ${details}`);
  }
}

function loadOverlay(name) {
  const filePath = path.join(FIXTURE_DIR, name);
  if (!fs.existsSync(filePath)) {
    fail(`Overlay fixture missing: ${normalizePath(filePath)}`);
  }
  return readJson(filePath);
}

async function main() {
  console.log('🔍 Checking visual viewer runtime contract...');

  const runtime = await loadRuntime();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson(SCHEMA_FILE));

  const simpleLeaf = loadOverlay('simple_leaf.overlay.json');
  const hostRoot = loadOverlay('host_root_topology.overlay.json');
  const mountedChild = loadOverlay('mounted_child_boundary.overlay.json');
  const routed = loadOverlay('parent_exit_routing.overlay.json');

  const simpleState = runtime.createVisualViewerState(simpleLeaf, {
    boundary_id: 'simple_leaf',
    lod: 'specification',
  });
  validateState(validate, simpleState, 'simple_leaf viewer state');
  if (simpleState.current_scope.boundary_id !== 'simple_leaf') {
    fail('simple_leaf viewer state selected the wrong current scope.');
  }
  if (simpleState.context_shell.public_exit_point_ids.length !== 1) {
    fail('simple_leaf viewer state did not expose public exits through context_shell.');
  }
  const simpleFrame = runtime.deriveVisualViewerFrame(simpleLeaf, simpleState);
  if (simpleFrame.visible.specification_nodes.some((entry) => entry.boundary_id !== 'simple_leaf')) {
    fail('simple_leaf specification frame leaked nodes across boundaries.');
  }

  const hostState = runtime.createVisualViewerState(hostRoot);
  validateState(validate, hostState, 'host_root_topology initial state');
  if (hostState.current_scope.boundary_id !== 'app_host_root') {
    fail('host_root_topology initial state must start at the explicit host_root boundary.');
  }
  if (hostState.current_scope.depth !== 0) {
    fail('host_root_topology initial state must start at depth 0.');
  }
  let hostUpFailed = false;
  try {
    runtime.reduceVisualViewerState(hostRoot, hostState, { type: 'up' });
  } catch {
    hostUpFailed = true;
  }
  if (!hostUpFailed) {
    fail('Viewer runtime must reject `up` from the explicit host_root anchor.');
  }
  const hostChildState = runtime.reduceVisualViewerState(hostRoot, hostState, {
    type: 'enter',
    target_boundary_id: 'summary_panel',
    portal_kind: 'mounted_child_relation',
    portal_id: 'mounted_child_relation:app_host_root:summary_panel',
  });
  validateState(validate, hostChildState, 'host_root_topology child enter state');
  if (hostChildState.current_scope.depth !== 1) {
    fail('Entering a child from host_root must increase depth to 1.');
  }
  const hostBackToRoot = runtime.reduceVisualViewerState(hostRoot, hostChildState, { type: 'up' });
  if (hostBackToRoot.current_scope.boundary_id !== 'app_host_root' || hostBackToRoot.current_scope.depth !== 0) {
    fail('Moving up from a child scope must return to host_root at depth 0.');
  }

  const parentState = runtime.createVisualViewerState(mountedChild, {
    boundary_id: 'parent_shell',
    lod: 'specification',
  });
  const peekState = runtime.reduceVisualViewerState(mountedChild, parentState, {
    type: 'peek',
    target_boundary_id: 'child_dialog',
  });
  validateState(validate, peekState, 'mounted_child peek state');
  if (peekState.current_scope.boundary_id !== 'parent_shell' || peekState.peek.boundary_id !== 'child_dialog') {
    fail('peek must preserve current scope while opening child preview.');
  }
  const parentFrame = runtime.deriveVisualViewerFrame(mountedChild, peekState);
  if (parentFrame.visible.specification_nodes.some((entry) => entry.boundary_id !== 'parent_shell')) {
    fail('parent specification frame must not auto-expand child internals.');
  }
  const childState = runtime.reduceVisualViewerState(mountedChild, peekState, {
    type: 'enter',
    target_boundary_id: 'child_dialog',
    portal_kind: 'mounted_child_relation',
    portal_id: 'mounted_child_relation:parent_shell:child_dialog',
  });
  validateState(validate, childState, 'mounted_child enter state');
  if (childState.current_scope.boundary_id !== 'child_dialog') {
    fail('enter did not switch scope to the child boundary.');
  }
  if (childState.context_shell.caller_boundary_id !== 'parent_shell') {
    fail('entered child state did not retain caller context in context_shell.');
  }
  if (childState.navigation_stack.length !== 1) {
    fail('enter must push exactly one navigation frame.');
  }
  const backFromChild = runtime.reduceVisualViewerState(mountedChild, childState, { type: 'back' });
  if (backFromChild.current_scope.boundary_id !== 'parent_shell') {
    fail('back must restore the parent scope after child enter.');
  }

  let routedState = runtime.createVisualViewerState(routed, {
    boundary_id: 'wizard_step',
    lod: 'flow',
  });
  validateState(validate, routedState, 'parent_exit_routing initial state');
  routedState = runtime.reduceVisualViewerState(routed, routedState, {
    type: 'open_trace',
    exit_point_id: 'exit_point:wizard_step:success',
  });
  validateState(validate, routedState, 'parent_exit_routing trace state');
  if (!routedState.trace_state.open || routedState.trace_state.projection_mode !== 'exit') {
    fail('open_trace must enable exit-scoped trace without changing LOD.');
  }
  if (routedState.current_lod !== 'flow') {
    fail('trace must remain separate from LOD.');
  }
  if (JSON.stringify(routedState.trace_state.continuation_mapping_ids) !== JSON.stringify(['continuation_mapping:wizard_step:success'])) {
    fail('trace must expose explicit continuation mappings from overlay.');
  }
  routedState = runtime.reduceVisualViewerState(routed, routedState, {
    type: 'center_on_exit',
    exit_point_id: 'exit_point:wizard_step:success',
  });
  if (routedState.focus?.entity_id !== 'exit_point:wizard_step:success') {
    fail('center_on_exit must focus the selected exit point.');
  }
  routedState = runtime.reduceVisualViewerState(routed, routedState, {
    type: 'enter',
    target_boundary_id: 'after_success',
    portal_kind: 'continuation',
    portal_id: 'continuation_mapping:wizard_step:success',
  });
  validateState(validate, routedState, 'parent_exit_routing continuation enter state');
  if (routedState.current_scope.boundary_id !== 'after_success') {
    fail('continuation enter must switch scope to the target boundary.');
  }
  if (routedState.context_shell.caller_boundary_id !== 'wizard_step') {
    fail('continuation enter must retain caller boundary context.');
  }

  const normalizedA = runtime.normalizeViewerStateForComparison(routedState);
  const normalizedB = runtime.normalizeViewerStateForComparison(routedState);
  if (JSON.stringify(normalizedA) !== JSON.stringify(normalizedB)) {
    fail('viewer runtime state normalization is not deterministic.');
  }

  console.log('✅ Visual viewer runtime contract OK');
}

try {
  await main();
} catch (error) {
  fail(`check-visual-viewer-runtime failed: ${error instanceof Error ? error.message : String(error)}`);
}
