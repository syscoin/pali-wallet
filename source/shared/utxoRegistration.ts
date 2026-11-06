import type { OwnedUtxoRpcVerification } from '@sidhujag/sysweb3-network';

export type UtxoRegistrationPin = Pick<
  OwnedUtxoRpcVerification,
  'registration' | 'backendChain'
>;

/** Detach a saved or explicitly observed pin for the SDK's owned verifier. */
export function createUtxoRegistrationPin(
  input: Readonly<{
    backendChain: unknown;
    chainId: unknown;
    slip44: unknown;
  }>
): UtxoRegistrationPin {
  const { chainId, slip44, backendChain } = input;
  if (
    typeof chainId !== 'number' ||
    !Number.isSafeInteger(chainId) ||
    chainId < 0 ||
    typeof slip44 !== 'number' ||
    !Number.isSafeInteger(slip44) ||
    slip44 < 0 ||
    typeof backendChain !== 'string' ||
    !/^[a-z0-9_-]{1,32}$/i.test(backendChain)
  )
    throw new Error('Invalid UTXO registration verification');

  return Object.freeze({
    registration: Object.freeze({ chainId, slip44 }),
    backendChain,
  });
}
