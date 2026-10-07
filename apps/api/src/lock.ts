/**
 * Per-key async mutex. Two texts from the same lead arriving a second apart must run
 * one after the other, otherwise both turns load the same history and the second
 * overwrites the first's context. In-process only: fine for a single API instance.
 */
const chains = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const next = prev.then(() => gate);
  chains.set(key, next);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(key) === next) chains.delete(key);
  }
}
