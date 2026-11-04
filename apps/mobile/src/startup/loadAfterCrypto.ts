/**
 * Loading an RNG consumer is part of crypto initialization: some dependencies
 * snapshot globalThis.crypto during module evaluation. Never call load first.
 * A terminal native failure may still load watch-only UI; custody retains the
 * rejected bootstrap promise and cannot become available through this result.
 */
export async function loadAfterNativeCrypto<T>(
  ensureCryptoReady: () => Promise<unknown>,
  load: () => T,
): Promise<T> {
  try { await ensureCryptoReady(); }
  catch { /* Watch-only UI may start after the native gate has failed closed. */ }
  return load();
}
