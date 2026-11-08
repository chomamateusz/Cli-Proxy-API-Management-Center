export interface KeyedSerialQueue {
  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  size(): number;
}

export function createKeyedSerialQueue(): KeyedSerialQueue {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.then(() => task());
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
    size: () => tails.size,
  };
}
