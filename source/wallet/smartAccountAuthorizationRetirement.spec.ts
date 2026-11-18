import { paliEntryPointInterface } from '../utils/smartAccount/contracts';

import { prepareSmartAccountAuthorizationRetirement } from './smartAccountAuthorizationRetirement';

const account = '0x' + '11'.repeat(20),
  blockHash = '0x' + '22'.repeat(32),
  hash = '0x' + '33'.repeat(32);
function fixture() {
  let current = true,
    chain = '0x1',
    head = '0xa',
    anchorHash = blockHash,
    nonce = BigInt(7);
  const rows = [
    { account, chainId: '1', operationHash: hash, operationNonce: '5' },
    {
      account,
      chainId: '1',
      operationHash: '0x' + '44'.repeat(32),
      operationNonce: '8',
    },
  ];
  const read = jest.fn(async (method: string, params: readonly unknown[]) => {
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_getBlockByNumber')
      return {
        number: params[0] === 'finalized' ? head : params[0],
        hash: anchorHash,
      };
    if (method === 'eth_call')
      return paliEntryPointInterface.encodeFunctionResult('getNonce', [nonce]);
    throw Error('unexpected');
  });
  const options = {
    account,
    chainId: 1,
    authorizations: rows,
    read,
    assertCurrent: () => {
      if (!current) throw Error('retired');
    },
  };
  return {
    options,
    read,
    chain: () => {
      chain = '0x2';
    },
    advance: () => {
      head = '0xb';
    },
    reorg: () => {
      anchorHash = hash;
    },
    retire: () => {
      current = false;
    },
    nonce: (value: bigint) => {
      nonce = value;
    },
  };
}

it('retires only finalized consumed nonces and rechecks the exact original anchor', async () => {
  const f = fixture(),
    result = await prepareSmartAccountAuthorizationRetirement(f.options);
  expect(result.hashes).toEqual([hash]);
  f.advance();
  await result.revalidate();
  expect(
    f.read.mock.calls
      .filter(([method]) => method === 'eth_call')
      .map(([, params]) => params[1])
  ).toEqual(['0xa', '0xa']);
  expect(
    f.read.mock.calls.some(([method]) => method === 'eth_getTransactionReceipt')
  ).toBe(false);
  f.reorg();
  await expect(result.revalidate()).rejects.toThrow();
});
it('does not retire a still-live nonce or another account or chain', async () => {
  const f = fixture();
  f.nonce(BigInt(5));
  f.options.authorizations.push(
    {
      account: '0x' + '66'.repeat(20),
      chainId: '1',
      operationHash: hash,
      operationNonce: '0',
    },
    { account, chainId: '2', operationHash: hash, operationNonce: '0' }
  );
  expect(
    (await prepareSmartAccountAuthorizationRetirement(f.options)).hashes
  ).toEqual([]);
});
it.each(['chain', 'retire', 'nonce'] as const)(
  'refuses changed %s evidence before commit',
  async (change) => {
    const f = fixture(),
      result = await prepareSmartAccountAuthorizationRetirement(f.options);
    if (change === 'nonce') f.nonce(BigInt(8));
    else f[change]();
    await expect(result.revalidate()).rejects.toThrow();
  }
);
it('refuses a nonce response for a different full nonce key', async () => {
  const f = fixture();
  f.nonce(BigInt(1) << BigInt(64));
  await expect(
    prepareSmartAccountAuthorizationRetirement(f.options)
  ).rejects.toThrow();
});
it('performs no RPC for an empty matching inventory', async () => {
  const f = fixture();
  f.options.authorizations = [];
  expect(
    (await prepareSmartAccountAuthorizationRetirement(f.options)).hashes
  ).toEqual([]);
  expect(f.read).not.toHaveBeenCalled();
});
