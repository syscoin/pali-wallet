jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
}));

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  PsbtUtils: {},
}));

import { getController } from 'scripts/Background';

import { getMethodConfig } from './method-registry';
import { methodRequest } from './requests';

describe('malformed transaction requests settle before admission', () => {
  it.each([
    { value: 'invalid' },
    { gasLimit: 'invalid' },
    { maxFeePerGas: 'invalid' },
    { to: 'invalid' },
    { input: '0x0' },
    { value: -1 },
    { from: ['0x' + '11'.repeat(20)] },
  ])('rejects %p before authentication, connection or RPC', async (fields) => {
    jest.mocked(getController).mockClear();
    await expect(
      methodRequest('https://metamask.github.io', {
        method: 'eth_sendTransaction',
        params: [
          {
            from: `0x${'11'.repeat(20)}`,
            to: `0x${'22'.repeat(20)}`,
            ...fields,
          },
        ],
      })
    ).rejects.toMatchObject({ code: -32602 });
    expect(getController).not.toHaveBeenCalled();
  });
  it.each([undefined, [], [null], [{}, {}]])(
    'rejects invalid request parameters %p',
    async (params) => {
      await expect(
        methodRequest('https://metamask.github.io', {
          method: 'eth_sendTransaction',
          params,
        })
      ).rejects.toMatchObject({ code: -32602 });
    }
  );
});

describe('malformed signing/network requests settle before admission', () => {
  it.each([
    ['personal_sign', ['0x12']],
    ['personal_sign', ['0x12', 'invalid']],
    ['personal_sign', [null, `0x${'11'.repeat(20)}`]],
    ['wallet_switchEthereumChain', [{ chainId: 'invalid' }]],
    ['wallet_switchEthereumChain', [{ chainId: '0x' }]],
    ['wallet_switchEthereumChain', [{ chainId: '0x20000000000000' }]],
    ['wallet_addEthereumChain', [{ chainId: '0x1' }]],
    ['wallet_addEthereumChain', [{ chainId: '0x1', rpcUrls: ['invalid'] }]],
    [
      'wallet_addEthereumChain',
      [{ chainId: '0x1', rpcUrls: ['javascript:foo'] }],
    ],
  ])('rejects malformed %s without prompting', async (method, params) => {
    jest.mocked(getController).mockClear();
    await expect(
      methodRequest('https://metamask.github.io', {
        method: method as string,
        params: params as any[],
      })
    ).rejects.toMatchObject({ code: -32602 });
    expect(getController).not.toHaveBeenCalled();
  });
});

describe('provider-facing signing methods', () => {
  it('rejects an excessive request before method dispatch', async () => {
    await expect(
      methodRequest('https://malicious.example', {
        method: 'personal_sign',
        params: ['a'.repeat(65537)],
      })
    ).rejects.toMatchObject({ code: -32602 });
  });
  it('rejects eth_sign as an unsupported provider method', async () => {
    expect(getMethodConfig('eth_sign')).toBeUndefined();

    await expect(
      methodRequest('malicious.example', {
        method: 'eth_sign',
        params: [
          '0x1111111111111111111111111111111111111111',
          `0x${'22'.repeat(32)}`,
        ],
      })
    ).rejects.toMatchObject({
      code: 4200,
    });
  });
});
