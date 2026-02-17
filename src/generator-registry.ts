import type { AdapterGeneratorRegistry, AdapterGeneratorSpec } from './types.ts';

export class InMemoryAdapterGeneratorRegistry implements AdapterGeneratorRegistry {
  private readonly generators: AdapterGeneratorSpec[] = [];

  register(spec: AdapterGeneratorSpec): void {
    if (this.generators.some((existing) => existing.id === spec.id)) {
      throw new Error(`Duplicate adapter generator id: ${spec.id}`);
    }
    this.generators.push(spec);
  }

  list(): AdapterGeneratorSpec[] {
    return [...this.generators].sort((a, b) => a.id.localeCompare(b.id));
  }

  async runAll(context: Parameters<AdapterGeneratorSpec['run']>[0]): Promise<void> {
    for (const generator of this.list()) {
      await generator.run(context);
    }
  }
}