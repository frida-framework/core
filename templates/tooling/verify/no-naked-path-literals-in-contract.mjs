#!/usr/bin/env node

/**
 * Enforce PATH_USAGE_POLICY:
 * - path-bearing machine fields must use PATHS.* refs
 * - typed *Ref/*Refs fields must resolve and match expected kind
 * - if a *Ref exists, corresponding literal siblings must not coexist
 *
 * Environment:
 * - REPORT_ONLY=1  -> print violations and exit 0
 * - WARN_TEXT_SCAN=1 -> optional warn-only scan for free-text path literals
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadModularContract } from '../lib/load-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const BOOTSTRAP_CONTRACT_REL = 'contract/contract.index.yaml';
const REPORT_ONLY = process.env.REPORT_ONLY === '1';
const WARN_TEXT_SCAN = process.env.WARN_TEXT_SCAN === '1';

const PATH_LITERAL_HINTS = [
  '/',
  '**',
  '.github/',
  'src/',
  'scripts/',
  'supabase/',
  'resources/',
  'contract/',
  'dist/',
  'tests/',
  'tasks/',
];

const WILDCARD_RE = /[*?\[\]{}]/;
const FILE_EXT_RE = /\.[A-Za-z0-9]+$/;
const SCRIPT_EXT_RE = /\.(?:m?js|cjs|ts|tsx|sh|ps1|py)$/i;
const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.(?:ya?ml)$/i;

function toPosix(value) {
  return value.replace(/\\/g, '/');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readYamlRel(relPath) {
  const normalizedRel = toPosix(relPath.trim());
  const absolutePath = path.resolve(ROOT_DIR, normalizedRel);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Contract artifact not found: ${normalizedRel}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const parsed = YAML.parse(raw);
  if (!isObject(parsed)) {
    throw new Error(`Contract artifact must parse to object: ${normalizedRel}`);
  }

  return { relPath: normalizedRel, absolutePath, parsed };
}

function getAtPath(root, pathParts) {
  let cursor = root;
  for (const part of pathParts) {
    if (!isObject(cursor) || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function loadContractArtifact() {
  const absolutePath = path.resolve(ROOT_DIR, BOOTSTRAP_CONTRACT_REL);
  const parsed = loadModularContract(ROOT_DIR);
  return { relPath: BOOTSTRAP_CONTRACT_REL, absolutePath, parsed };
}

function normalizePolicy(contract) {
  const policy = contract.PATH_USAGE_POLICY;
  if (!isObject(policy)) {
    throw new Error('PATH_USAGE_POLICY block missing in contract artifact');
  }

  const failMode = policy.pathBearingMachineFields?.failMode || {};
  const warnOnlyTextScan = policy.pathBearingMachineFields?.warnOnlyTextScan || {};
  const typedSuffixMapping = policy.typedSuffixMapping || {};
  const typedSuffixes = Object.keys(typedSuffixMapping);

  if (typedSuffixes.length === 0) {
    throw new Error('PATH_USAGE_POLICY.typedSuffixMapping must define at least one suffix');
  }

  const typedSuffixesSorted = typedSuffixes
    .slice()
    .sort((a, b) => b.length - a.length || a.localeCompare(b));

  const refPatternSource = policy.refFormat?.pattern || '^PATHS\\.[A-Za-z0-9_.-]+$';
  const refPattern = new RegExp(refPatternSource);

  const allowedLiteralBlocks = new Set(
    [
      ...(Array.isArray(policy.allowedLiteralScopes?.contractBlockRefs)
        ? policy.allowedLiteralScopes.contractBlockRefs
        : []),
      ...(Array.isArray(policy.allowedLiteralScopes?.optionalContractBlockRefs)
        ? policy.allowedLiteralScopes.optionalContractBlockRefs
        : []),
    ]
      .filter((item) => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
  );

  const legacyLiteralFieldNames = new Set(
    (Array.isArray(failMode.legacyLiteralFieldNames) ? failMode.legacyLiteralFieldNames : [])
      .filter((item) => typeof item === 'string')
      .map((item) => item.toLowerCase())
  );

  const legacyFieldPathRegexes = (Array.isArray(failMode.legacyFieldPathPatterns)
    ? failMode.legacyFieldPathPatterns
    : [])
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => new RegExp(item));

  const excludedScanBlocks = new Set(
    (Array.isArray(failMode.excludedBlockRefs) ? failMode.excludedBlockRefs : [])
      .filter((item) => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
  );

  const freeTextFieldNames = new Set(
    (Array.isArray(failMode.freeTextFieldNames) ? failMode.freeTextFieldNames : [])
      .filter((item) => typeof item === 'string')
      .map((item) => item.toLowerCase())
  );

  const fieldPathKindOverrides = isObject(policy.kindClassification?.fieldPathKindOverrides)
    ? policy.kindClassification.fieldPathKindOverrides
    : {};

  const literalSiblingOverrides = isObject(policy.migration?.literalSiblingOverrides)
    ? policy.migration.literalSiblingOverrides
    : {};

  const warnEnvFlag = typeof warnOnlyTextScan.envFlag === 'string'
    ? warnOnlyTextScan.envFlag
    : 'WARN_TEXT_SCAN';

  return {
    refPattern,
    typedSuffixMapping,
    typedSuffixesSorted,
    allowedLiteralBlocks,
    legacyLiteralFieldNames,
    legacyFieldPathRegexes,
    excludedScanBlocks,
    freeTextFieldNames,
    fieldPathKindOverrides,
    literalSiblingOverrides,
    warnTextScanEnabled: WARN_TEXT_SCAN || process.env[warnEnvFlag] === '1',
  };
}

function flattenPaths(node, prefix = 'PATHS', table = new Map()) {
  if (!isObject(node)) {
    return table;
  }

  for (const key of Object.keys(node).sort((a, b) => a.localeCompare(b))) {
    const value = node[key];
    const nextKey = `${prefix}.${key}`;
    if (typeof value === 'string') {
      table.set(nextKey, value);
    } else if (isObject(value)) {
      flattenPaths(value, nextKey, table);
    }
  }

  return table;
}

function normalizeArrayIndices(pathString) {
  return pathString.replace(/\[\d+\]/g, '[]');
}

function topBlock(pathString) {
  const match = pathString.match(/^([A-Za-z0-9_]+)/);
  return match ? match[1] : '';
}

function isAllowedLiteralScope(pathString, allowedLiteralBlocks) {
  return allowedLiteralBlocks.has(topBlock(pathString));
}

function isExcludedScanBlock(pathString, excludedScanBlocks) {
  return excludedScanBlocks.has(topBlock(pathString));
}

function looksLikePathLiteral(value) {
  if (typeof value !== 'string') {
    return false;
  }

  return PATH_LITERAL_HINTS.some((hint) => value.includes(hint)) || WILDCARD_RE.test(value);
}

function matchesLegacyFieldPath(fieldPath, legacyFieldPathRegexes) {
  if (legacyFieldPathRegexes.length === 0) {
    return true;
  }
  return legacyFieldPathRegexes.some((regex) => regex.test(fieldPath));
}

function matchTypedSuffix(fieldName, typedSuffixesSorted) {
  const fieldNameLower = fieldName.toLowerCase();
  for (const suffix of typedSuffixesSorted) {
    if (fieldNameLower.endsWith(suffix.toLowerCase())) {
      return suffix;
    }
  }
  return null;
}

function classifyPathLiteral(value) {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 'unknown';
  }

  const scopeParts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (scopeParts.length > 1) {
    return 'scope';
  }

  if (WORKFLOW_RE.test(normalized)) {
    return 'workflow';
  }

  const hasWildcard = WILDCARD_RE.test(normalized);
  if (!hasWildcard && SCRIPT_EXT_RE.test(normalized)) {
    return 'script';
  }

  if (hasWildcard) {
    return 'glob';
  }

  const tail = normalized.split('/').filter(Boolean).pop() || '';
  if (FILE_EXT_RE.test(tail)) {
    return 'file';
  }

  return 'dir';
}

function kindCompatible(expectedKind, actualKind) {
  switch (expectedKind) {
    case 'file':
      return actualKind === 'file' || actualKind === 'script' || actualKind === 'workflow';
    case 'dir':
      return actualKind === 'dir';
    case 'glob':
      return actualKind === 'glob';
    case 'scope':
      return (
        actualKind === 'scope' ||
        actualKind === 'glob' ||
        actualKind === 'dir' ||
        actualKind === 'file' ||
        actualKind === 'script' ||
        actualKind === 'workflow'
      );
    case 'script':
      return actualKind === 'script';
    case 'workflow':
      return actualKind === 'workflow';
    default:
      return true;
  }
}

function getOverrideKind(pathString, policy) {
  const normalizedPath = normalizeArrayIndices(pathString);
  const overrides = policy.fieldPathKindOverrides;
  if (typeof overrides[normalizedPath] === 'string') {
    return overrides[normalizedPath];
  }
  return null;
}

function getLiteralSiblingOverride(key, overrides) {
  if (Array.isArray(overrides[key])) {
    return overrides[key];
  }

  const keyLower = key.toLowerCase();
  for (const candidate of Object.keys(overrides)) {
    if (candidate.toLowerCase() === keyLower && Array.isArray(overrides[candidate])) {
      return overrides[candidate];
    }
  }

  return [];
}

function deriveLiteralSiblingCandidates(refFieldName, typedSuffix) {
  const base = refFieldName.slice(0, refFieldName.length - typedSuffix.length);
  const isPlural = typedSuffix.toLowerCase().endsWith('refs');
  const candidates = new Set();

  if (base.length > 0) {
    candidates.add(base);
    if (isPlural) {
      candidates.add(`${base}s`);
    }
  }

  const suffixStrips = ['File', 'Dir', 'Glob', 'Scope', 'Script', 'Workflow'];
  for (const strip of suffixStrips) {
    if (base.endsWith(strip)) {
      const stripped = base.slice(0, -strip.length);
      if (stripped.length > 0) {
        candidates.add(stripped);
        if (isPlural) {
          candidates.add(`${stripped}s`);
        }
      }
    }
  }

  return [...candidates];
}

function formatValue(value) {
  return JSON.stringify(value);
}

function addViolation(violations, code, pathString, value, detail) {
  violations.push({
    code,
    path: pathString,
    value,
    detail,
  });
}

function auditContract(contract, policy) {
  const violations = [];
  const warnings = [];
  const pathsTable = flattenPaths(contract.PATHS || {});

  function checkRefLiteralCoexistence(node, nodePath) {
    if (isExcludedScanBlock(nodePath, policy.excludedScanBlocks)) {
      return;
    }

    const keys = Object.keys(node);
    for (const key of keys) {
      const typedSuffix = matchTypedSuffix(key, policy.typedSuffixesSorted);
      if (!typedSuffix) {
        continue;
      }

      const siblingCandidates = new Set([
        ...deriveLiteralSiblingCandidates(key, typedSuffix),
        ...getLiteralSiblingOverride(key, policy.literalSiblingOverrides),
      ]);

      for (const sibling of siblingCandidates) {
        if (sibling === key) {
          continue;
        }

        if (Object.prototype.hasOwnProperty.call(node, sibling)) {
          addViolation(
            violations,
            'REF_LITERAL_COEXISTENCE',
            nodePath ? `${nodePath}.${sibling}` : sibling,
            node[sibling],
            `${key} exists in same object`
          );
        }
      }
    }
  }

  function inspectScalarField(fieldPath, fieldName, value, typedSuffix) {
    if (isExcludedScanBlock(fieldPath, policy.excludedScanBlocks)) {
      return;
    }

    const fieldNameLower = fieldName.toLowerCase();
    const isFreeText = policy.freeTextFieldNames.has(fieldNameLower);

    if (isFreeText) {
      if (policy.warnTextScanEnabled && typeof value === 'string' && looksLikePathLiteral(value)) {
        warnings.push({
          path: fieldPath,
          value,
          detail: 'free-text field contains path-like literal (warn-only)',
        });
      }
      return;
    }

    const isLegacyPathField =
      policy.legacyLiteralFieldNames.has(fieldNameLower) &&
      matchesLegacyFieldPath(fieldPath, policy.legacyFieldPathRegexes);
    const isTypedPathField = Boolean(typedSuffix);
    const isPathBearing = isTypedPathField || isLegacyPathField;

    if (!isPathBearing) {
      return;
    }

    if (isAllowedLiteralScope(fieldPath, policy.allowedLiteralBlocks)) {
      return;
    }

    if (typeof value !== 'string') {
      addViolation(
        violations,
        'PATH_FIELD_NOT_STRING',
        fieldPath,
        value,
        'path-bearing field value must be string'
      );
      return;
    }

    const trimmed = value.trim();
    if (!policy.refPattern.test(trimmed)) {
      addViolation(
        violations,
        looksLikePathLiteral(trimmed) ? 'NAKED_PATH_LITERAL' : 'PATH_REF_REQUIRED',
        fieldPath,
        value,
        'expected PATHS.* reference'
      );
      return;
    }

    if (!isTypedPathField) {
      return;
    }

    const resolvedLiteral = pathsTable.get(trimmed);
    if (typeof resolvedLiteral !== 'string') {
      addViolation(
        violations,
        'PATH_REF_UNRESOLVED',
        fieldPath,
        value,
        `reference not found in PATHS map: ${trimmed}`
      );
      return;
    }

    const overrideKind = getOverrideKind(fieldPath, policy);
    const expectedKind = overrideKind || policy.typedSuffixMapping[typedSuffix];
    if (typeof expectedKind !== 'string' || expectedKind.trim().length === 0) {
      return;
    }

    const actualKind = classifyPathLiteral(resolvedLiteral);
    if (!kindCompatible(expectedKind, actualKind)) {
      addViolation(
        violations,
        'PATH_REF_KIND_MISMATCH',
        fieldPath,
        value,
        `expected kind=${expectedKind}, actual kind=${actualKind}, resolved=${resolvedLiteral}`
      );
    }
  }

  function visit(node, nodePath) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const childPath = `${nodePath}[${i}]`;
        const value = node[i];
        if (typeof value === 'string') {
          // Array items are checked through parent field logic.
        } else if (isObject(value) || Array.isArray(value)) {
          visit(value, childPath);
        }
      }
      return;
    }

    if (!isObject(node)) {
      return;
    }

    checkRefLiteralCoexistence(node, nodePath);

    for (const key of Object.keys(node).sort((a, b) => a.localeCompare(b))) {
      const value = node[key];
      const fieldPath = nodePath ? `${nodePath}.${key}` : key;
      const typedSuffix = matchTypedSuffix(key, policy.typedSuffixesSorted);

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          const item = value[i];
          if (typeof item === 'string') {
            inspectScalarField(`${fieldPath}[${i}]`, key, item, typedSuffix);
          } else if (item !== null && item !== undefined) {
            inspectScalarField(`${fieldPath}[${i}]`, key, item, typedSuffix);
          }
        }
      } else if (typeof value === 'string') {
        inspectScalarField(fieldPath, key, value, typedSuffix);
      } else if (value !== null && value !== undefined && !isObject(value)) {
        inspectScalarField(fieldPath, key, value, typedSuffix);
      }

      if (isObject(value) || Array.isArray(value)) {
        visit(value, fieldPath);
      }
    }
  }

  for (const topKey of Object.keys(contract).sort((a, b) => a.localeCompare(b))) {
    visit(contract[topKey], topKey);
  }

  violations.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    const byCode = a.code.localeCompare(b.code);
    if (byCode !== 0) return byCode;
    return formatValue(a.value).localeCompare(formatValue(b.value));
  });

  warnings.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return formatValue(a.value).localeCompare(formatValue(b.value));
  });

  return { violations, warnings };
}

function main() {
  let artifact;
  try {
    artifact = loadContractArtifact();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(2);
  }

  let policy;
  try {
    policy = normalizePolicy(artifact.parsed);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(2);
  }

  const { violations, warnings } = auditContract(artifact.parsed, policy);

  console.log(`Contract artifact: ${artifact.relPath}`);
  console.log(`Path policy block: PATH_USAGE_POLICY`);

  if (warnings.length > 0) {
    console.log(`Warn-only text scan findings: ${warnings.length}`);
    for (const warning of warnings) {
      console.log(`WARN ${warning.path} = ${formatValue(warning.value)} (${warning.detail})`);
    }
  }

  if (violations.length === 0) {
    console.log('OK: no naked path literals detected in path-bearing machine fields');
    process.exit(0);
  }

  console.log(`Violations: ${violations.length}`);
  for (const violation of violations) {
    console.log(
      `VIOLATION ${violation.path} = ${formatValue(violation.value)} [${violation.code}] (${violation.detail})`
    );
  }

  if (REPORT_ONLY) {
    console.log('REPORT_ONLY=1 -> exiting with code 0');
    process.exit(0);
  }

  process.exit(1);
}

main();
