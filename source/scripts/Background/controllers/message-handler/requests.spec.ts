jest.mock('scripts/Background', () => ({
  getController: jest.fn(),
}));

jest.mock('@sidhujag/sysweb3-keyring', () => ({
  PsbtUtils: {},
}));

import { getController } from 'scripts/Background';

import { getMethodConfig } from './method-registry';
import { getPipelineInstance } from './request-pipeline';
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

describe('personal_sign byte encoding admission', () => {
  const address = `0x${'11'.repeat(20)}`;
  const siwe = `victim.example wants you to sign in with your Ethereum account:\n${address}\n\n\nURI: https://victim.example\nVersion: 1\nChain ID: 1\nNonce: 12345678\nIssued At: 2026-10-11T10:00:00.000Z`;
  const encodedSiwe = `0x${Buffer.from(siwe).toString('hex')}`;

  afterEach(() => jest.restoreAllMocks());

  it.each(
    [
      '0xmalformed',
      '0xabc',
      '0x12z34',
      '0x1234\n',
      `${encodedSiwe}zz`,
      `${encodedSiwe}a`,
    ].flatMap((payload) => [
      [payload, address],
      [address, payload],
    ])
  )(
    'rejects ambiguous bytes in either parameter order before prompting: %p',
    async (...params) => {
      jest.mocked(getController).mockClear();
      const execute = jest.spyOn(getPipelineInstance()!, 'execute');
      await expect(
        methodRequest('https://requester.example', {
          method: 'personal_sign',
          params,
        })
      ).rejects.toMatchObject({
        code: -32602,
        message:
          'personal_sign hexadecimal messages must contain complete bytes',
      });
      expect(execute).not.toHaveBeenCalled();
      expect(getController).not.toHaveBeenCalled();
    }
  );

  it.each(
    ['', '0x', '0xAbCd', 'An ordinary message 日本語', '0Xmalformed'].flatMap(
      (payload) => [
        [payload, address, '0xlegacy-password'],
        [address, payload, '0xlegacy-password'],
      ]
    )
  )(
    'preserves valid messages and original parameter order: %p',
    async (...params) => {
      const original = [...params];
      const execute = jest
        .spyOn(getPipelineInstance()!, 'execute')
        .mockResolvedValue('0xsignature');
      await expect(
        methodRequest('https://requester.example', {
          method: 'personal_sign',
          params,
        })
      ).resolves.toBe('0xsignature');
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0][0].originalRequest.params).toEqual(original);
      expect(params).toEqual(original);
    }
  );
});
