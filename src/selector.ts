import type { SelectorMatch, SourceSelectorSpec, ResolvedSelectorResult, ResolvedSourceMap } from './types.ts';

interface SelectorSegment {
  kind: 'key' | 'wildcard' | 'arrayWildcard';
  value?: string;
}

function splitSelector(selector: string): string[] {
  return selector
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function parseSelector(selector: string): SelectorSegment[] {
  const segments: SelectorSegment[] = [];
  for (const part of splitSelector(selector)) {
    if (part === '*') {
      segments.push({ kind: 'wildcard' });
      continue;
    }

    if (part.endsWith('[*]')) {
      const key = part.slice(0, -3);
      if (key) {
        segments.push({ kind: 'key', value: key });
      }
      segments.push({ kind: 'arrayWildcard' });
      continue;
    }

    segments.push({ kind: 'key', value: part });
  }
  return segments;
}

function toPath(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment;
}

function extractMatches(value: unknown, segments: SelectorSegment[], path: string, out: SelectorMatch[], selectorId: string, selector: string): void {
  if (segments.length === 0) {
    out.push({ selectorId, selector, path, value });
    return;
  }

  const [head, ...tail] = segments;

  if (head.kind === 'key') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    const next = (value as Record<string, unknown>)[head.value as string];
    if (typeof next === 'undefined') {
      return;
    }
    extractMatches(next, tail, toPath(path, head.value as string), out, selectorId, selector);
    return;
  }

  if (head.kind === 'wildcard') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const next = (value as Record<string, unknown>)[key];
      extractMatches(next, tail, toPath(path, key), out, selectorId, selector);
    }
    return;
  }

  if (head.kind === 'arrayWildcard') {
    if (!Array.isArray(value)) {
      return;
    }
    for (let index = 0; index < value.length; index += 1) {
      extractMatches(value[index], tail, `${path}[${index}]`, out, selectorId, selector);
    }
  }
}

export function resolveSelector(root: Record<string, any>, spec: SourceSelectorSpec): ResolvedSelectorResult {
  const segments = parseSelector(spec.selector);
  const matches: SelectorMatch[] = [];
  extractMatches(root, segments, '', matches, spec.id, spec.selector);

  matches.sort((a, b) => a.path.localeCompare(b.path));
  return {
    spec,
    matches,
  };
}

export function resolveSelectors(root: Record<string, any>, specs: SourceSelectorSpec[]): ResolvedSourceMap {
  const ordered: ResolvedSelectorResult[] = [];
  const byId = new Map<string, ResolvedSelectorResult>();

  for (const spec of specs) {
    const result = resolveSelector(root, spec);
    ordered.push(result);
    byId.set(spec.id, result);
  }

  return {
    byId,
    ordered,
  };
}