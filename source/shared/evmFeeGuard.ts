/** Require each authority checkpoint to finish before dependent work begins. */
export function assertSynchronousEvmFeeGuard(guard: () => void): void {
  const result: unknown = guard();
  if (result !== undefined) {
    if (result && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => undefined);
    throw new Error('EVM fee approval guard must be synchronous');
  }
}
