/**
 * mount-all.ts - Master orchestrator for mounting wizard and timeline
 *
 * This script:
 * 1. Verifies stubs are in place
 * 2. Runs surgeon scripts that transform dist/aistudio sources according to contract
 * 3. Generates page wrappers
 *
 * IMPORTANT: Does NOT copy files directly from dist/aistudio.
 * Uses surgeon scripts which apply contract-defined transformations.
 */

import { logStep, writeFile, fileExists } from './lib/mapper-utils';

const wizardWrapper = `import React from 'react';
import { useNavigate } from 'react-router-dom';
import WizardApp from '@/mount/wizard/App';
import { quickSelectLocations } from '@/data/popularLocations';

const WizardAppAny = WizardApp as React.ComponentType<any>;

export const WizardPage: React.FC = () => {
  const navigate = useNavigate();

  const handleComplete = (routeId: string) => {
    navigate(\`/route/\${routeId}\`);
  };

  const handleError = (error: Error) => {
    console.error('Route generation failed:', error);
  };

  return (
    <WizardAppAny
      onComplete={handleComplete}
      onError={handleError}
      destinationChips={quickSelectLocations}
    />
  );
};

export default WizardPage;
`;


// === MAIN ===
// NOTE: Validation (assertStubState) is now Phase 1 (scripts/mapper/validate.ts)
// and runs before this script in the mapper:all pipeline.

logStep('Запуск surgeon-wizard (трансформация по контракту)');
if (fileExists('dist/aistudio/wizard/App.tsx')) {
  await import('./mapper/surgeon-wizard');
  console.log('  ✓ WizardApp обработан через surgeon');
} else {
  console.log('  ⚠ dist/aistudio/wizard/App.tsx не найден, используется заглушка');
}

logStep('Запуск surgeon-timeline (трансформация по контракту)');
if (fileExists('dist/aistudio/timeline/App.tsx')) {
  await import('./mapper/surgeon-timeline');
  console.log('  ✓ TimelineApp обработан через surgeon');
} else {
  console.log('  ⚠ dist/aistudio/timeline/App.tsx не найден, используется заглушка');
}

logStep('Генерация обёрток из контрактного маппера');
writeFile('src/mount/pages/WizardPage.tsx', wizardWrapper);
writeFile(
  'src/mount/pages/index.ts',
  `export { default as WizardPage } from './WizardPage';
`,
);
writeFile('src/mount/index.ts', `export * from './pages';
`);

console.log('✅ Обёртки смонтированы, роутинг уже настроен в src/App.tsx');
