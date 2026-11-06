export class EvmCancellationPayerCodeError extends Error {
  readonly code = 'EVM_CANCELLATION_PAYER_CODE';

  constructor() {
    super('Unable to verify a code-free cancellation payer');
    this.name = 'EvmCancellationPayerCodeError';
  }
}

export class EvmCancellationNonceError extends Error {
  readonly code = 'EVM_CANCELLATION_NONCE';

  constructor() {
    super('Unable to verify a ready cancellation nonce');
    this.name = 'EvmCancellationNonceError';
  }
}

/** A cancellation must target the first available nonce on the observed chain. */
export function assertEvmCancellationNonceReady(
  nonce: number | string,
  latestNonce: unknown
): void {
  if (
    (typeof nonce === 'number'
      ? !Number.isSafeInteger(nonce) || nonce < 0
      : typeof nonce !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(nonce)) ||
    typeof latestNonce !== 'string' ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(latestNonce)
  )
    throw new EvmCancellationNonceError();
  const expected = BigInt(nonce);
  if (expected >= BigInt(1) << BigInt(256) || BigInt(latestNonce) !== expected)
    throw new EvmCancellationNonceError();
}

function checkCurrent(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result === undefined) return;
  if (result && (typeof result === 'object' || typeof result === 'function'))
    void Promise.resolve(result).catch(() => undefined);
  throw new EvmCancellationPayerCodeError();
}

function checkPayer(payer: string): void {
  if (typeof payer !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(payer))
    throw new EvmCancellationPayerCodeError();
}

/** A zero-value empty self-call can execute delegated account code. */
export async function assertEvmCancellationPayerHasNoCode(
  payer: string,
  readCode: (address: string, tag: string) => Promise<unknown>,
  assertCurrent: () => void,
  canonicalTag = 'latest'
): Promise<void> {
  checkPayer(payer);
  if (
    typeof canonicalTag !== 'string' ||
    (canonicalTag !== 'latest' &&
      !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(canonicalTag))
  )
    throw new EvmCancellationPayerCodeError();
  const requireEmpty = async (tag: string) => {
    checkCurrent(assertCurrent);
    const code = await readCode(payer, tag);
    checkCurrent(assertCurrent);
    if (code !== '0x') throw new EvmCancellationPayerCodeError();
  };
  await Promise.all([requireEmpty(canonicalTag), requireEmpty('pending')]);
  checkCurrent(assertCurrent);
}

export async function assertEvmCancellationPayerReady(
  payer: string,
  nonce: number | string,
  read: (
    method: 'eth_getTransactionCount' | 'eth_getCode',
    address: string,
    tag: string
  ) => Promise<unknown>,
  assertCurrent: () => void
): Promise<void> {
  checkPayer(payer);
  checkCurrent(assertCurrent);
  const latestNonce = await read('eth_getTransactionCount', payer, 'latest');
  checkCurrent(assertCurrent);
  // The previous nonce can install delegation before this nonce becomes ready.
  // Code must be observed after the nonce check.
  assertEvmCancellationNonceReady(nonce, latestNonce);
  await assertEvmCancellationPayerHasNoCode(
    payer,
    (address, tag) => read('eth_getCode', address, tag),
    assertCurrent
  );
  checkCurrent(assertCurrent);
}
