type LeafOperation = { cancel(): void; run(): Promise<Uint8Array> };
type LeafContext = {
  importKey(kind: string, usages: string[], bytes: Uint8Array): object;
  importPublicSlhFixtureSeed(): object;
  prepareSlhLeafChunk(key: object, start: number, count: number): LeafOperation;
  close(): void;
};
type LeafModule = { SlhLeafOperation: unknown; createContext(): LeafContext };

// Pinned extension's public SHA2-128-24 fixture leaves 0–2.
const leavesHex = 'c36b833b844736c488df16e0b8a4cc5a606f2c5b3129219893046c137ba7a30b89bcf186f6e619a8a0b66ec91e6c3dbb';

async function expectRejected(action: () => unknown): Promise<void> {
  try { await action(); }
  catch { return; }
  throw Error('QUALIFICATION_SLH_LEAF_REJECTION_REQUIRED');
}

/** Exercise the setup-only bridge without enabling a signer or opening a wallet. */
export async function qualifyNativeSlhLeaf(module: LeafModule): Promise<void> {
  const constructor = module.SlhLeafOperation;
  if (typeof constructor !== 'function') throw Error('QUALIFICATION_SLH_LEAF_CLASS_MISSING');
  await expectRejected(() => Reflect.construct(constructor, []));

  const context = module.createContext();
  const foreign = module.createContext();
  try {
    await expectRejected(() => context.importKey('SLH-DSA-SEED', ['derivePublic'], new Uint8Array(48)));
    const key = context.importPublicSlhFixtureSeed();
    await expectRejected(() => foreign.prepareSlhLeafChunk(key, 0, 1));
    await expectRejected(() => context.prepareSlhLeafChunk(key, 4_194_304, 1));
    for (const invalid of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE]) {
      await expectRejected(() => context.prepareSlhLeafChunk(key, invalid, 1));
      await expectRejected(() => context.prepareSlhLeafChunk(key, 0, invalid));
    }
    const operation = context.prepareSlhLeafChunk(key, 0, 3);
    if (!(operation instanceof constructor)) throw Error('QUALIFICATION_SLH_LEAF_CLASS_MISMATCH');
    const leaves = await operation.run();
    if (!(leaves instanceof Uint8Array) || leaves.byteLength !== 48 ||
        Array.from(leaves, (byte) => byte.toString(16).padStart(2, '0')).join('') !== leavesHex)
      throw Error('QUALIFICATION_SLH_LEAF_VECTOR_FAILED');
    await expectRejected(() => operation.run());

    const cancelled = context.prepareSlhLeafChunk(key, 0, 1);
    cancelled.cancel();
    await expectRejected(() => cancelled.run());
    const retired = context.prepareSlhLeafChunk(key, 0, 1);
    context.close();
    await expectRejected(() => retired.run());
    await expectRejected(() => context.importPublicSlhFixtureSeed());
  } finally {
    foreign.close();
    context.close();
  }
}
