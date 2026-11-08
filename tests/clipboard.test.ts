import { afterEach, describe, expect, test } from 'bun:test';
import { copyToClipboard } from '../src/utils/clipboard';

interface FakeTextarea {
  value: string;
  style: Record<string, string>;
  setAttribute: () => void;
  focus: () => void;
  select: () => void;
  setSelectionRange: () => void;
}

const globals = globalThis as unknown as { document?: unknown };
const originalDocument = globals.document;

function installDocument(execCommand: () => boolean) {
  const attached: FakeTextarea[] = [];
  globals.document = {
    activeElement: null,
    body: {
      appendChild: (node: FakeTextarea) => attached.push(node),
      removeChild: (node: FakeTextarea) => attached.splice(attached.indexOf(node), 1),
    },
    createElement: (): FakeTextarea => ({
      value: '',
      style: {},
      setAttribute: () => {},
      focus: () => {},
      select: () => {},
      setSelectionRange: () => {},
    }),
    execCommand,
  };
  return attached;
}

afterEach(() => {
  globals.document = originalDocument;
});

describe('copyToClipboard fallback', () => {
  test('removes the temporary textarea when execCommand throws', async () => {
    const attached = installDocument(() => {
      throw new DOMException('blocked', 'NotAllowedError');
    });
    expect(await copyToClipboard('sk-fleet-FAKE')).toBe(false);
    expect(attached).toEqual([]);
  });

  test('removes the temporary textarea after a successful copy', async () => {
    const attached = installDocument(() => true);
    expect(await copyToClipboard('sk-fleet-FAKE')).toBe(true);
    expect(attached).toEqual([]);
  });
});
