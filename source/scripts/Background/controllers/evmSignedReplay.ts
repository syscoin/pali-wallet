import { Transaction } from 'ethers/transaction';

import { assertEvmCancellationPayerReady } from '../../../shared/evmCancellationPayer.ts';
import { observeEvmTransaction } from '../../../shared/evmTransactionObservation.ts';
import {
  EvmReplayError,
  EvmSignedReplay,
  type EvmReplaySession,
} from '../../../wallet/evmSignedReplay.ts';

import type { EvmSignedRecords } from '../../../wallet/evmSignedRecords.ts';

type Captured = Omit<EvmReplaySession, 'observe' | 'dispatch'> &
  Readonly<{
    provider: { send(method: string, params: any[]): Promise<any> };
  }>;

/** The extension contributes its existing captured provider, never a new RPC client. */
export function createExtensionEvmReplay(
  records: EvmSignedRecords,
  capture: () => Captured
): EvmSignedReplay {
  return new EvmSignedReplay(records, () => {
    const captured = capture();
    captured.assertCurrent();
    const send = captured.provider.send.bind(captured.provider);
    return Object.freeze({
      context: captured.context,
      recordSession: captured.recordSession,
      assertCurrent: captured.assertCurrent,
      observe: (expected) =>
        observeEvmTransaction(
          expected,
          (method, params) => send(method, [...params]),
          captured.assertCurrent
        ),
      dispatch: (raw, admit, context) => {
        const broadcast = () => send('eth_sendRawTransaction', [raw]);
        if (context.operation !== 'cancel') return admit(broadcast);
        const tx = Transaction.from(raw);
        if (
          (tx.type !== 0 && tx.type !== 2) ||
          tx.from?.toLowerCase() !== context.from.toLowerCase() ||
          tx.to !== tx.from ||
          tx.value !== BigInt(0) ||
          tx.data !== '0x' ||
          tx.accessList?.length
        )
          throw new EvmReplayError('INVALID_RESPONSE');
        return admit(broadcast, () =>
          assertEvmCancellationPayerReady(
            context.from,
            context.nonce,
            (method, address, tag) => send(method, [address, tag]),
            captured.assertCurrent
          )
        );
      },
    });
  });
}
