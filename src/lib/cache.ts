type Entry<T> = { value: T; expireAt: number };

const store = new Map<string, Entry<unknown>>();

export function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expireAt > Date.now()) {
    return Promise.resolve(hit.value as T);
  }
  return loader().then((value) => {
    store.set(key, { value, expireAt: Date.now() + ttlMs });
    return value;
  });
}
