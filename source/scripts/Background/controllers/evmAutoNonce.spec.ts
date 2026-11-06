import { EvmAutoNonceAcceptance } from '../../../shared/evmAutoNonce';
import { planExtensionEvmNonce, reviewedExtensionNonce } from './evmAutoNonce';

const from = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const chainId = '5700';
const endpoint = 'https://rpc.invalid';
const retained = { chainId, from, hash, nonce: 0, phase: 'signed' as const };

function fixture(latest: string, pending: string) {
  const abort = new AbortController();
  const acceptance = new EvmAutoNonceAcceptance();
  const replies = new Map([
    ['eth_getTransactionCount:latest', latest],
    ['eth_getTransactionCount:pending', pending],
    ['eth_getBalance:pending', '0x7'],
    ['eth_getBalance:latest', '0x7'],
  ]);
  const provider = {
    signal: abort.signal,
    verifyConfiguredChainId: jest.fn(async () => undefined),
    send: jest.fn(async (method: string, [, tag]: unknown[]) => {
      const value = replies.get(`${method}:${String(tag)}`);
      if (value === undefined) throw new Error(`Unexpected ${method}`);
      return value;
    }),
  };
  const input = {
    acceptance,
    assertCurrent: () => undefined,
    provider,
    scope: { chainId, endpoint, from },
    snapshot: {
      owner: 'wallet',
      retained: [] as (typeof retained)[],
      readMaximumCost: jest.fn(async () => BigInt(5)),
    },
  };
  return { abort, input, provider, replies };
}

it('advances across an exact acknowledged predecessor only if its cost and this send fit', async () => {
  const { input, replies } = fixture('0x0', '0x0');
  input.snapshot.retained.push(retained);
  input.acceptance.track(input.snapshot.owner, endpoint, retained)(hash);
  const approved = {
    ...input,
    minimumBalance: BigInt(3),
    reviewed: reviewedExtensionNonce(1, 'automatic'),
  };
  await expect(planExtensionEvmNonce(approved)).rejects.toMatchObject({
    message: 'Insufficient balance for pending transfers.',
    transactionNotBroadcast: true,
  });
  replies.set('eth_getBalance:pending', '0x8');
  await expect(planExtensionEvmNonce(approved)).resolves.toMatchObject({
    nonce: 1,
    state: 'pending',
    maximumPredecessorCost: BigInt(5),
  });
});

it('uses the canonical state if the two fresh reads report an older pending count', async () => {
  const { input, provider } = fixture('0x1', '0x0');
  await expect(
    planExtensionEvmNonce({ ...input, minimumBalance: BigInt(1) })
  ).resolves.toMatchObject({ nonce: 1, state: 'latest' });
  expect(provider.send).toHaveBeenCalledWith('eth_getBalance', [
    from,
    'latest',
  ]);
});

it('preserves an explicitly selected zero and never reuses an owned nonce', async () => {
  const { input } = fixture('0x0', '0x1');
  const explicit = { ...input, reviewed: reviewedExtensionNonce(0, 'manual') };
  await expect(planExtensionEvmNonce(explicit)).resolves.toMatchObject({
    nonce: 0,
    state: 'latest',
  });
  input.snapshot.retained.push(retained);
  await expect(planExtensionEvmNonce(explicit)).rejects.toMatchObject({
    message: expect.stringContaining('saved transaction'),
    transactionNotBroadcast: true,
  });
});

it('requires fresh review when the exact approved automatic nonce moved', async () => {
  const { input } = fixture('0x1', '0x2');
  await expect(
    planExtensionEvmNonce({
      ...input,
      reviewed: reviewedExtensionNonce(1, 'automatic'),
    })
  ).rejects.toMatchObject({
    message: expect.stringContaining('Review this transfer again'),
    transactionNotBroadcast: true,
  });
});
