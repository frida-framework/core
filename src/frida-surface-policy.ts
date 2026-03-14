export const GENERATED_CONTRACT_MARKER = 'AUTO-GENERATED FROM CONTRACT';
export const GENERATED_FRIDA_MARKER = 'FRIDA';

export const SOURCE_MANAGEMENT_PLAYBOOK_PREFIX = 'templates/management/';
export const DEPLOYED_MANAGEMENT_PLAYBOOK_PREFIX = '.frida/contract/playbooks/';

export const PROJECTED_INTERNAL_ONLY_KEYS = ['source_playbook_ref'] as const;

export const PROJECTED_SOURCE_ONLY_PREFIXES = [
  'core-contract/',
  'core-templates/management/',
  'core-tasks/',
  SOURCE_MANAGEMENT_PLAYBOOK_PREFIX,
  'templates/frida/',
  'templates/docs-gen/',
  'templates/template_app_basic/',
] as const;

export const PROJECTED_STRING_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['core-contract/', 'contract/'],
  ['.frida/templates/management/', 'undeployed management template paths'],
  ['INT_FRIDA_ZONES', 'the private internal zone block'],
  ['FRIDA_INT_AGENT_ROUTING', 'private self-routing metadata'],
  ['FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT', 'the private self-contract-management interface'],
  ['AGENT-frida-internal-contract-update.md', 'an internal Frida contract-management playbook'],
  ['AGENT-frida-internal-contract-repair.md', 'an internal Frida contract-management playbook'],
] as const;

export const BOOTLOADER_FORBIDDEN_REFERENCE_TOKENS = [
  '.frida/templates/management/',
] as const;

export const PROJECTED_CORE_FORBIDDEN_TOKENS = [
  ...PROJECTED_SOURCE_ONLY_PREFIXES,
  'FRIDA_INTERFACE_SELF_CONTRACT_MANAGEMENT',
  'FRIDA_INT_AGENT_ROUTING',
  'INT_FRIDA_ZONES',
  'source_playbook_ref:',
] as const;

export const FORBIDDEN_LOCAL_CORE_PACKAGE_REFERENCE = 'file:../frida';

export const GENERATED_SURFACE_MARKERS = [
  GENERATED_CONTRACT_MARKER,
  GENERATED_FRIDA_MARKER,
] as const;
