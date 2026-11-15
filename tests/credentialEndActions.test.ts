import { describe, expect, test } from 'bun:test';
import {
  createCredentialEndActions,
  type CredentialEndActionDeps,
} from '../src/features/quota/credentialEndActions';
import type { AuthFileItem } from '../src/types';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const setup = (reload: () => Promise<boolean>) => {
  const calls = { move: 0, reload: 0, notify: [] as string[] };
  const deps: CredentialEndActionDeps = {
    patchEnd: async () => undefined,
    markCancelled: async () => 'scheduled',
    moveEndToNextPeriod: async () => {
      calls.move += 1;
    },
    reload: () => {
      calls.reload += 1;
      return reload();
    },
    notify: (key) => calls.notify.push(key),
    sameSession: () => true,
    applyLocalEnd: () => undefined,
    endsMovedToNextPeriod: new Map(),
  };
  return { actions: createCredentialEndActions(deps), calls };
};

const overdue = (fleetEndsAt: string): AuthFileItem => ({
  name: 'claude.json',
  type: 'claude',
  fleetEndsAt,
  fleetEndState: 'overdue',
  fleetEndsAtSource: 'claude-anniversary',
});

describe('next period action', () => {
  test('stays pending until the reloaded list is applied', async () => {
    const pending = deferred<boolean>();
    const { actions, calls } = setup(() => pending.promise);
    let settled = false;
    const run = actions.nextPeriod(overdue('2026-11-07T21:09:56Z')).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.move).toBe(1);
    expect(calls.reload).toBe(1);
    expect(settled).toBe(false);
    pending.resolve(true);
    await run;
    expect(settled).toBe(true);
  });

  test('a repeat on the same stale end only reloads after a failed reload', async () => {
    const { actions, calls } = setup(async () => false);
    const stale = overdue('2026-11-07T21:09:56Z');
    await actions.nextPeriod(stale);
    await actions.nextPeriod(stale);
    expect(calls.move).toBe(1);
    expect(calls.reload).toBe(2);
    expect(calls.notify).toEqual(['credential_end.next_period_saved']);
  });

  test('moves again once the list carries the new end', async () => {
    const { actions, calls } = setup(async () => true);
    await actions.nextPeriod(overdue('2026-11-07T21:09:56Z'));
    await actions.nextPeriod(overdue('2026-12-07T21:09:56Z'));
    expect(calls.move).toBe(2);
  });
});

describe('cancel action', () => {
  test('waits for the reload before resolving', async () => {
    const pending = deferred<boolean>();
    const { actions, calls } = setup(() => pending.promise);
    let outcome: string | null = null;
    const run = actions.cancel({ name: 'claude.json', type: 'claude' }).then((value) => {
      outcome = value;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.reload).toBe(1);
    expect(outcome).toBeNull();
    pending.resolve(true);
    await run;
    expect(outcome).toBe('scheduled');
  });
});
