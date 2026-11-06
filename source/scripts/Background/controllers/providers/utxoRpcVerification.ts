import type { OwnedUtxoRpcVerification } from '@sidhujag/sysweb3-network';

import {
  abortable,
  boundedResponseText,
  cancelResponseBody,
} from '../../../../shared/boundedHttp';
import { withWalletBackend } from './walletHttpIdentity';

type UtxoRpcReadOwner = Pick<
  OwnedUtxoRpcVerification,
  'assertCurrent' | 'readJson' | 'signal'
>;

export async function withUtxoRpcVerification<T>(
  endpoint: string,
  checkScope: () => void,
  operation: (owner: UtxoRpcReadOwner) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const { signal } = controller;
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const assertCurrent = () => {
    if (signal.aborted) throw new Error('UTXO verification expired');
    checkScope();
  };
  try {
    assertCurrent();
    const result = await abortable(
      withWalletBackend(endpoint, () => {
        assertCurrent();
        return operation({
          assertCurrent,
          signal,
          readJson: async (url, ownerSignal) => {
            assertCurrent();
            if (ownerSignal !== signal)
              throw new Error('Wrong UTXO verification owner');
            const response = await fetch(url, {
              method: 'GET',
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
              referrerPolicy: 'no-referrer',
              headers: { Accept: 'application/json' },
              signal,
            });
            try {
              assertCurrent();
              if (
                !response.ok ||
                response.redirected ||
                (response.url && response.url !== url) ||
                !response.body
              )
                throw new Error('Invalid UTXO response');
              return JSON.parse(
                await boundedResponseText(response, signal, 32_768)
              );
            } catch (error) {
              cancelResponseBody(response);
              throw error;
            }
          },
        });
      }),
      signal
    );
    assertCurrent();
    return result;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
