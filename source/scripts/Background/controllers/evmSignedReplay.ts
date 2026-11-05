import { Transaction } from 'ethers/transaction';

import {
  assertEvmCancellationPayerReady,
  isEvmProtectedEmptySelfCall,
} from '../../../shared/evmCancellationPayer.ts';
import { observeEvmTransaction } from '../../../shared/evmTransactionObservation.ts';
import {
  EvmReplayError,
  EvmSignedReplay,
  type EvmReplaySession,
} from '../../../wallet/evmSignedReplay.ts';

import type { EvmSignedRecords } from '../../../wallet/evmSignedRecords.ts';
import type { CustomJsonRpcProvider } from '@sidhujag/sysweb3-keyring';

type Captured = Omit<EvmReplaySession, 'observe' | 'dispatch'> &
  Readonly<{
    provider: Pick<CustomJsonRpcProvider, 'send' | '_send'>;
  }>;

export async function assertLiveEvmReplacementChain(
  provider: Pick<CustomJsonRpcProvider, '_send'>,
  chainId: string | number,
  assertCurrent: () => void
): Promise<void> {
  assertCurrent();
  // The provider's ordinary send method caches eth_chainId.
  const id = 0;
  const replies = await provider._send({
    jsonrpc: '2.0',
    id,
    method: 'eth_chainId',
    params: [],
  });
  assertCurrent();
  const response: unknown =
    Array.isArray(replies) && replies.length === 1 ? replies[0] : null;
  if (
    !response ||
    typeof response !== 'object' ||
    !('jsonrpc' in response) ||
    response.jsonrpc !== '2.0' ||
    !('id' in response) ||
    response.id !== id ||
    'error' in response ||
    !('result' in response) ||
    typeof response.result !== 'string' ||
    !/^0x[1-9a-f][0-9a-f]{0,63}$/i.test(response.result) ||
    BigInt(response.result) !== BigInt(chainId)
  )
    throw new EvmReplayError('CONTEXT_CHANGED');
}

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
        if (context.operation !== 'cancel' && !context.requiresPayerCheck)
          return admit(broadcast);
        const tx = Transaction.from(raw);
        if (
          tx.from?.toLowerCase() !== context.from.toLowerCase() ||
          !isEvmProtectedEmptySelfCall(tx, context.operation)
        )
          throw new EvmReplayError('INVALID_RESPONSE');
        return admit(broadcast, async () => {
          await assertLiveEvmReplacementChain(
            captured.provider,
            context.chainId,
            captured.assertCurrent
          );
          await assertEvmCancellationPayerReady(
            context.from,
            context.nonce,
            (method, address, tag) => send(method, [address, tag]),
            captured.assertCurrent
          );
        });
      },
    });
  });
}
