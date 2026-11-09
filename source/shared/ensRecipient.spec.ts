import { resolveEnsRecipientName } from './ensRecipient';

const name = 'Recipient.eth';
const address = '0x1111111111111111111111111111111111111111';

it('verifies the fresh ENS source after resolving the exact input name', async () => {
  const calls: string[] = [];
  const result = await resolveEnsRecipientName(name, {
    async resolveName(input) {
      calls.push(input);
      return address;
    },
    async readChainId() {
      calls.push('eth_chainId');
      return '0x1';
    },
  });
  expect(result).toBe(address);
  expect(calls).toEqual([name, 'eth_chainId']);
});

it('rejects an honest source chain change during the lookup', async () => {
  let chainId = '0x1';
  expect(
    await resolveEnsRecipientName(name, {
      async resolveName() {
        chainId = '0x2';
        return address;
      },
      async readChainId() {
        return chainId;
      },
    })
  ).toBeNull();
});

it.each([null, undefined, 1, {}, '1', '0x2', '0x', `0x${'0'.repeat(65)}1`])(
  'refuses a missing, malformed or different source chain identity: %p',
  async (chainId) => {
    expect(
      await resolveEnsRecipientName(name, {
        resolveName: async () => address,
        readChainId: async () => chainId,
      })
    ).toBeNull();
  }
);

it('does not publish a lookup when the final source identity request fails', async () => {
  expect(
    await resolveEnsRecipientName(name, {
      resolveName: async () => address,
      readChainId: async () => {
        throw new Error('Source RPC unavailable');
      },
    })
  ).toBeNull();
});

it.each([null, 'invalid'])(
  'unresolved addresses skip the final source query: %p',
  async (resolved) => {
    const readChainId = jest.fn();
    expect(
      await resolveEnsRecipientName(name, {
        resolveName: async () => resolved,
        readChainId,
      })
    ).toBeNull();
    expect(readChainId).not.toHaveBeenCalled();
  }
);

it('does not access the resolver or source identity for non-ENS input', async () => {
  const resolveName = jest.fn(),
    readChainId = jest.fn();
  expect(
    await resolveEnsRecipientName(address, { resolveName, readChainId })
  ).toBeNull();
  expect(resolveName).not.toHaveBeenCalled();
  expect(readChainId).not.toHaveBeenCalled();
});
