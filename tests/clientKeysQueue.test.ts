import { describe, expect, test } from 'bun:test';
import { createKeyedSerialQueue } from '../src/features/clientKeys/keyedQueue';

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createKeyedSerialQueue', () => {
  test('runs tasks with the same key one after another', async () => {
    const queue = createKeyedSerialQueue();
    const log: string[] = [];
    const first = deferred();
    const a = queue.run('k', async () => {
      log.push('a:start');
      await first.promise;
      log.push('a:end');
      return 'a';
    });
    const b = queue.run('k', async () => {
      log.push('b:start');
      return 'b';
    });
    await flush();
    expect(log).toEqual(['a:start']);
    first.resolve();
    expect(await a).toBe('a');
    expect(await b).toBe('b');
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
  });

  test('runs different keys in parallel', async () => {
    const queue = createKeyedSerialQueue();
    const log: string[] = [];
    const slow = deferred();
    const a = queue.run('x', async () => {
      log.push('x:start');
      await slow.promise;
      log.push('x:end');
    });
    const b = queue.run('y', async () => {
      log.push('y:start');
      log.push('y:end');
    });
    await b;
    expect(log).toEqual(['x:start', 'y:start', 'y:end']);
    slow.resolve();
    await a;
    expect(log).toEqual(['x:start', 'y:start', 'y:end', 'x:end']);
  });

  test('a rejection does not block the next task', async () => {
    const queue = createKeyedSerialQueue();
    const failing = queue.run('k', async () => {
      throw new Error('nope');
    });
    const next = queue.run('k', async () => 'ok');
    await expect(failing).rejects.toThrow('nope');
    expect(await next).toBe('ok');
  });

  test('cleans up settled keys', async () => {
    const queue = createKeyedSerialQueue();
    await queue.run('a', async () => 1);
    await queue
      .run('b', async () => {
        throw new Error('x');
      })
      .catch(() => undefined);
    await flush();
    expect(queue.size()).toBe(0);
  });
});
