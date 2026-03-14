export { FRIDA_CLI_NAME, FRIDA_PACKAGE_NAME, FRIDA_PACKAGE_VERSION } from './generated/identity.ts';
import { FRIDA_PACKAGE_NAME } from './generated/identity.ts';

export const FRIDA_CONTRACT_SCHEMA_REF = `${FRIDA_PACKAGE_NAME}/schemas/frida-contract.schema.json`;
export const FRIDA_VISUAL_OVERLAY_SCHEMA_REF = `${FRIDA_PACKAGE_NAME}/schemas/frida-visual-overlay.schema.json`;
export const FRIDA_VISUAL_VIEWER_RUNTIME_SCHEMA_REF =
  `${FRIDA_PACKAGE_NAME}/schemas/frida-visual-viewer-runtime.schema.json`;
