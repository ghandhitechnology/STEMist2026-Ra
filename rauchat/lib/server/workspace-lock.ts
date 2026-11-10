/** Serialize host writes and output publication for each user's workspace. */
const shared = globalThis as typeof globalThis & {
  __rauchatWorkspaceLocks?: Map<string, Promise<void>>;
};
const locks = (shared.__rauchatWorkspaceLocks ??= new Map<
  string,
  Promise<void>
>());
export async function withWorkspaceLock<T>(
  userId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => held);
  locks.set(userId, chain);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(userId) === chain) locks.delete(userId);
  }
}
