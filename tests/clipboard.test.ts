import { afterEach, describe, expect, test } from 'bun:test';
import { copyToClipboard } from '../src/utils/clipboard';

interface Focusable {
  focus: () => void;
}

interface FakeTextarea extends Focusable {
  value: string;
  style: Record<string, string>;
  setAttribute: () => void;
  select: () => void;
  setSelectionRange: () => void;
}

interface FakeDocument {
  activeElement: Focusable | null;
}

const globals = globalThis as unknown as { document?: unknown };
const originalDocument = globals.document;

function installDocument(execCommand: () => boolean) {
  const attached: FakeTextarea[] = [];
  const doc: FakeDocument & Record<string, unknown> = {
    activeElement: null,
    body: {
      appendChild: (node: FakeTextarea) => attached.push(node),
      removeChild: (node: FakeTextarea) => {
        attached.splice(attached.indexOf(node), 1);
        if (doc.activeElement === node) doc.activeElement = null;
      },
    },
    createElement: (): FakeTextarea => {
      const textarea: FakeTextarea = {
        value: '',
        style: {},
        setAttribute: () => {},
        focus: () => {
          doc.activeElement = textarea;
        },
        select: () => {},
        setSelectionRange: () => {},
      };
      return textarea;
    },
    execCommand,
  };
  const trigger: Focusable = {
    focus: () => {
      doc.activeElement = trigger;
    },
  };
  trigger.focus();
  globals.document = doc;
  return { attached, doc, trigger };
}

afterEach(() => {
  globals.document = originalDocument;
});

describe('copyToClipboard fallback', () => {
  test('removes the temporary textarea when execCommand throws', async () => {
    const { attached } = installDocument(() => {
      throw new DOMException('blocked', 'NotAllowedError');
    });
    expect(await copyToClipboard('sk-fleet-FAKE')).toBe(false);
    expect(attached).toEqual([]);
  });

  test('removes the temporary textarea after a successful copy', async () => {
    const { attached } = installDocument(() => true);
    expect(await copyToClipboard('sk-fleet-FAKE')).toBe(true);
    expect(attached).toEqual([]);
  });

  test('returns focus to the trigger when execCommand throws', async () => {
    const { doc, trigger } = installDocument(() => {
      throw new DOMException('blocked', 'NotAllowedError');
    });
    expect(await copyToClipboard('sk-fleet-FAKE')).toBe(false);
    expect(doc.activeElement).toBe(trigger);
  });

  test('returns focus to the trigger after a successful copy', async () => {
    const { doc, trigger } = installDocument(() => true);
    expect(await copyToClipboard('sk-fleet-FAKE')).toBe(true);
    expect(doc.activeElement).toBe(trigger);
  });
});
