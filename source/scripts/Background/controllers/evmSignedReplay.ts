import { observeEvmTransaction } from '../../../shared/evmTransactionObservation.ts';
import {
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
      dispatch: (raw) => send('eth_sendRawTransaction', [raw]),
    });
  });
}
