import { EvmAutoNonceAcceptance } from '../../../source/shared/evmAutoNonce.ts';
import type { NativeAutomaticNoncePlanner } from '../src/custody/evmTransferReadRpc.ts';

/** Fee/transport fixtures have no retained transactions; still run the real policy. */
export const emptyNoncePlanner: NativeAutomaticNoncePlanner = input =>
  new EvmAutoNonceAcceptance().plan({
    ...input,
    chainId: '1',
    endpoint: 'https://nonce-fixture.invalid',
    from: input.assetState?.from ?? `0x${'11'.repeat(20)}`,
    snapshot: {
      owner: 'empty-nonce-fixture',
      minimumNonce: 0,
      retained: [],
      readMaximumCost: async () => { throw new Error('No retained transaction'); },
      readAssetDebit: async () => { throw new Error('No retained asset'); },
    },
  });
