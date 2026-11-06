type NativePublicMerkleModule = Readonly<{
  publicMerkleBatch(program: Uint8Array): Promise<Uint8Array>;
}>;

/** Native public arithmetic drains before returning, including after cancellation. */
export function createPublicMerkleExecutor(module: NativePublicMerkleModule) {
  if (typeof module?.publicMerkleBatch !== 'function')
    throw new Error('Native public Merkle arithmetic is unavailable');
  const execute = module.publicMerkleBatch.bind(module);
  return async (program: Uint8Array, signal: AbortSignal, assertCurrent: () => void) => {
    const check = () => {
      if (signal.aborted) throw new Error('privacy_cancelled');
      const result: unknown = assertCurrent();
      if (result !== undefined) {
        if (result && (typeof result === 'object' || typeof result === 'function'))
          void Promise.resolve(result).catch(() => undefined);
        throw new Error('privacy_cancelled');
      }
      if (signal.aborted) throw new Error('privacy_cancelled');
    };
    check();
    const result = await execute(program);
    check();
    return result;
  };
}
