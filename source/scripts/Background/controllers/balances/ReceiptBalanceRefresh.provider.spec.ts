import { readTrackedTokenBalance } from './ReceiptBalanceRefresh';

// Exercise the installed transport rather than a provider-shaped test double.
const { CustomJsonRpcProvider } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/providers'
);
const A = `0x${'11'.repeat(20)}`;
const T = `0x${'33'.repeat(20)}`;

it.each([0, 255, '255'])('uses scoped RPC at %s decimals', async (decimals) => {
  const abort = new AbortController();
  const provider = new CustomJsonRpcProvider(
    abort.signal,
    'https://rpc.test',
    1
  );
  const calls: any[] = [];
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockImplementation(async (url, init) => {
      const request = JSON.parse(init!.body as string);
      calls.push({
        url,
        init,
        request,
        abortedAtDispatch: init!.signal?.aborted,
      });
      const result =
        request.method === 'eth_blockNumber'
          ? '0x14'
          : request.method === 'eth_getBalance'
          ? '0x1'
          : `0x${'0'.repeat(63)}7`;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
        json: async () => ({ jsonrpc: '2.0', id: request.id, result }),
      } as Response;
    });
  try {
    expect(calls).toHaveLength(0); // no constructor polling or network detection
    expect(provider.configuredChainId).toBe(BigInt(1));
    await provider.send('eth_blockNumber', []);
    await provider.getBalance(A, 20);
    expect(
      await readTrackedTokenBalance(
        provider,
        A,
        {
          chainId: 1,
          contractAddress: T,
          decimals,
          balance: 0,
          isNft: false,
          tokenSymbol: 'T',
          tokenStandard: 'ERC-20',
        },
        20
      )
    ).toEqual({ balance: decimals === 0 ? 7 : 7e-255, rawBalance: '7' });
    expect(calls.map(({ request }) => request.method)).toEqual([
      'eth_blockNumber',
      'eth_getBalance',
      'eth_call',
    ]);
    expect(
      calls.every(
        ({ url, init, abortedAtDispatch }) =>
          url === 'https://rpc.test' &&
          init.signal instanceof AbortSignal &&
          abortedAtDispatch === false
      )
    ).toBe(true);
    expect(abort.signal.aborted).toBe(false);
    expect(provider.signal.aborted).toBe(false);
    expect(calls[1].request.params).toEqual([A, '0x14']);
    expect(calls[2].request.params[1]).toBe('0x14');
  } finally {
    abort.abort();
    provider.destroy();
    fetch.mockRestore();
  }
});

it('actually aborts a pending installed-provider fetch without retrying', async () => {
  const abort = new AbortController();
  const provider = new CustomJsonRpcProvider(
    abort.signal,
    'https://rpc.test',
    1
  );
  let transportSignal: AbortSignal | undefined;
  let didFetch!: () => void;
  const fetched = new Promise<void>((resolve) => {
    didFetch = resolve;
  });
  const fetch = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    transportSignal = init!.signal as AbortSignal;
    didFetch();
    return new Promise((_resolve, reject) => {
      transportSignal!.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true }
      );
    });
  });
  try {
    const pending = provider.send('eth_blockNumber', []);
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    });
    await fetched;
    expect(transportSignal!.aborted).toBe(false);
    abort.abort();
    await rejected;
    expect(transportSignal!.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    provider.destroy();
    fetch.mockRestore();
  }
});
