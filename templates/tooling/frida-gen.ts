#!/usr/bin/env tsx
import { runFridaGeneration } from './frida-core-bridge.ts';
import { createContractDrivenAdapter } from './frida-contract-adapter.ts';

const APP_CONTRACT_INBOX_INDEX = '.frida/inbox/app-contract/contract.index.yaml';

async function main(): Promise<void> {
  const strictSchema = process.argv.includes('--strict-schema');
  await runFridaGeneration({
    rootDir: process.cwd(),
    contractPath: APP_CONTRACT_INBOX_INDEX,
    strictSchema,
    adapters: [createContractDrivenAdapter({ rootDir: process.cwd(), contractPath: APP_CONTRACT_INBOX_INDEX })],
  });
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
