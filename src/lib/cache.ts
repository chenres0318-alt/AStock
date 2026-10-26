type Entry<T> = { value: T; expireAt: number };

const MAX_ENTRIES = 300;
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function prune(now = Date.now()) {
  for (const [key, entry] of store) {
    if (entry.expireAt <= now) store.delete(key);
  }
  if (store.size <= MAX_ENTRIES) return;
  const extra = store.size - MAX_ENTRIES;
  let dropped = 0;
  for (const key of store.keys()) {
    store.delete(key);
    dropped += 1;
    if (dropped >= extra) break;
  }
}

export function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expireAt > now) {
    return Promise.resolve(hit.value as T);
  }
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = loader()
    .then((value) => {
      prune();
      store.set(key, { value, expireAt: Date.now() + ttlMs });
      inflight.delete(key);
      return value;
    })
    .catch((error) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, promise);
  return promise;
}
