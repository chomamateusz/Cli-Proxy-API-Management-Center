import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FEATURE_DIR = 'src/features/clientKeys';
const API_MODULE = 'src/services/api/clientKeys.ts';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const featureFiles = walk(FEATURE_DIR);
const codeFiles = [...featureFiles.filter((file) => /\.tsx?$/.test(file)), API_MODULE];
const styleFiles = featureFiles.filter((file) => file.endsWith('.module.scss'));
const read = (file: string) => readFileSync(file, 'utf8');

const withoutStrings = (source: string) =>
  source.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");

const callArguments = (source: string, callee: RegExp): string[] => {
  const calls: string[] = [];
  for (const match of source.matchAll(callee)) {
    let depth = 0;
    const start = (match.index ?? 0) + match[0].length - 1;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      if (source[index] === ')') depth -= 1;
      if (depth === 0) {
        calls.push(source.slice(start, index + 1));
        break;
      }
    }
  }
  return calls;
};

describe('client keys source contracts', () => {
  test('no console, window.confirm, any or v0 endpoints', () => {
    const offenders = codeFiles.filter((file) =>
      /console\.|window\.confirm|:\s*any\b|as any\b|\/v0\//.test(read(file))
    );
    expect(offenders).toEqual([]);
  });

  test('styles use theme tokens instead of colour literals', () => {
    expect(styleFiles.length).toBeGreaterThan(0);
    expect(styleFiles.filter((file) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(read(file)))).toEqual([]);
  });

  test('raw backend field names stay in the API module', () => {
    const raw = ["'excluded-models'", "'issued-by'", "'expires-at'", "'created-at'"];
    const offenders = featureFiles
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => raw.some((name) => read(file).includes(name)));
    expect(offenders).toEqual([]);
    expect(raw.every((name) => read(API_MODULE).includes(name))).toBe(true);
  });

  test('the issued secret never reaches toasts, announcements or translations', () => {
    const sinks = /(?:showNotification|notifyError|setAnnouncement|\bt)\(/g;
    const offenders = codeFiles.filter((file) =>
      callArguments(withoutStrings(read(file)), sinks).some((args) => /\bsecret\b/.test(args))
    );
    expect(offenders).toEqual([]);
    const controller = withoutStrings(read(join(FEATURE_DIR, 'clientKeysController.ts')));
    const writes = callArguments(controller, /\bupdate\(/g);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.filter((args) => /\bsecret\b/.test(args))).toEqual([]);
    const hook = read(join(FEATURE_DIR, 'hooks/useClientKeysData.ts'));
    expect(hook).not.toMatch(/useState<[^>]*Secret/);
    expect(hook).not.toMatch(/\bsecret\b/);
  });

  test('the route and navigation entry are registered', () => {
    expect(read('src/router/MainRoutes.tsx')).toContain("'/client-keys'");
    expect(read('src/components/layout/MainLayout.tsx')).toContain("'nav.client_keys'");
  });

  test('policies are only patched, never replaced', () => {
    expect(read(API_MODULE)).not.toContain('apiClient.put');
  });
});
