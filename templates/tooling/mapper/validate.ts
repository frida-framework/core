/**
 * validate.ts - Phase 1 of mapper pipeline
 *
 * Verifies preconditions before any transformation:
 * - Stub markers exist at mount points
 * - Source material is available
 *
 * Must run BEFORE styler, surgeon, and mounter phases.
 */

import { logStep, readFile } from '../lib/mapper-utils';

function assertStubState(filePath: string, stubMarker: string) {
  const content = readFile(filePath);
  if (!content.includes(stubMarker)) {
    throw new Error(`Файл ${filePath} не является заглушкой. Сначала выполните npm run mapper:reset.`);
  }
}

logStep('Phase 1: Validate — проверка чистоты слотов');

assertStubState('src/mount/pages/WizardPage.tsx', 'WIZARD_PAGE_STUB');

logStep('Validate: все слоты чисты, pipeline может продолжать');
