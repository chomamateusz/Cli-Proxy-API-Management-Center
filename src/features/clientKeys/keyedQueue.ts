export interface KeyedSerialQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  cancel(): void;
  size(): number;
}

const cancelledError = () => new DOMException('The queued task was cancelled.', 'AbortError');

export function createKeyedSerialQueue(): KeyedSerialQueue {
  const tails = new Map<string, Promise<unknown>>();
  let epoch = 0;
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const scheduledIn = epoch;
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(() => {
        if (scheduledIn !== epoch) throw cancelledError();
        return task();
      });
      const tail = result.then(
        () => undefined,
        () => undefined
      );
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
    cancel: () => {
      epoch += 1;
    },
    size: () => tails.size,
  };
}
