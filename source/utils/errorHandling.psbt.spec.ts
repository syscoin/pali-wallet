jest.mock('utils/index', () => ({ truncate: jest.fn() }));

import { handleTransactionError } from './errorHandling';
import { UTXO_SIGNING_CONTEXT_CHANGED } from './utxoSigningContext';

describe('PSBT signing errors', () => {
  it.each([
    [
      { code: 'PSBT_ACCOUNT_SCOPE_MISMATCH' },
      'transactions.psbtAccountScopeError',
    ],
    [
      new Error('PSBT input is outside the approved account'),
      'transactions.psbtAccountScopeError',
    ],
    ...[
      'Trezor returned a different unsigned transaction',
      'Trezor changed an already-finalized input',
      'Trezor external input has an invalid prevout',
      'Trezor external input is missing its prevout',
    ].map((message): [Error, string] => [
      new Error(message),
      'transactions.psbtAccountScopeError',
    ]),
    [
      { code: 'PSBT_SIGNING_CONTEXT_CHANGED' },
      'transactions.psbtSigningContextChanged',
    ],
    [
      new Error(UTXO_SIGNING_CONTEXT_CHANGED),
      'transactions.psbtSigningContextChanged',
    ],
    [
      new Error('Wallet signing context changed'),
      'transactions.psbtSigningContextChanged',
    ],
    [{ code: 'UTXO_NETWORK_CATCHING_UP' }, 'send.networkCatchingUp'],
    [
      new Error(
        'The network is still updating your previous transaction. Please try again shortly.'
      ),
      'send.networkCatchingUp',
    ],
  ])('translates %p without exposing internal errors', (error, key) => {
    const alert = { error: jest.fn() };
    const t = jest.fn((value) => `translated:${value}`);
    expect(handleTransactionError(error, alert, t)).toBe(true);
    expect(t).toHaveBeenCalledWith(key);
    expect(alert.error).toHaveBeenCalledWith(`translated:${key}`);
  });

  it('does not classify unrelated provider messages as account-scope errors', () => {
    const alert = { error: jest.fn() };
    const t = jest.fn();
    expect(
      handleTransactionError(new Error('provider unavailable'), alert, t)
    ).toBe(false);
    expect(alert.error).not.toHaveBeenCalled();
  });
});
