export async function mapPool<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * 工作一边进队列一边处理。pull 空且 closed 时退出。
 * wait 必须在有新任务或 closed 时被唤醒，避免空转。
 */
export async function runDynamicPool<T>(
  concurrency: number,
  options: {
    pull: () => T | undefined;
    closed: () => boolean;
    wait: () => Promise<void>;
    work: (item: T) => Promise<void>;
  },
): Promise<void> {
  const { pull, closed, wait, work } = options;
  const run = async () => {
    while (true) {
      const item = pull();
      if (item !== undefined) {
        await work(item);
        continue;
      }
      if (closed()) return;
      await wait();
    }
  };
  await Promise.all(Array.from({ length: Math.max(concurrency, 1) }, () => run()));
}

/** 到期返回 undefined，后台那份 Promise 继续跑。ms<=0 立刻放弃等待。 */
export async function raceDeadline<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  if (ms <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then((value) => {
        if (timer) clearTimeout(timer);
        return value;
      }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
