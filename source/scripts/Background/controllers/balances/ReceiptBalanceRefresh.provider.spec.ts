import { readTrackedTokenBalance } from './ReceiptBalanceRefresh';

// Exercise the installed transport rather than a provider-shaped test double.
const { CustomJsonRpcProvider } = jest.requireActual(
  '@sidhujag/sysweb3-keyring/cjs/providers'
);
const A = `0x${'11'.repeat(20)}`;
const T = `0x${'33'.repeat(20)}`;

it('passes the same abort signal and captured endpoint to each minimal receipt RPC', async () => {
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
      calls.push({ url, init, request });
      const result =
        request.method === 'eth_blockNumber'
          ? '0x14'
          : request.method === 'eth_getBalance'
          ? '0x1'
          : `0x${'0'.repeat(63)}7`;
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: request.id, result }),
      } as Response;
    });
  try {
    expect(calls).toHaveLength(0); // no constructor polling or network detection
    expect(provider.configuredChainId).toBe(1);
    await provider.send('eth_blockNumber', []);
    await provider.getBalance(A, 20);
    expect(
      await readTrackedTokenBalance(
        provider,
        A,
        {
          contractAddress: T,
          decimals: 0,
          balance: 0,
          isNft: false,
          tokenSymbol: 'T',
          tokenStandard: 'ERC-20',
        },
        20
      )
    ).toEqual({ balance: 7, rawBalance: '7' });
    expect(calls.map(({ request }) => request.method)).toEqual([
      'eth_blockNumber',
      'eth_getBalance',
      'eth_call',
    ]);
    expect(
      calls.every(
        ({ url, init }) =>
          url === 'https://rpc.test' && init.signal === abort.signal
      )
    ).toBe(true);
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
  const fetch = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    transportSignal = init!.signal as AbortSignal;
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
    expect(transportSignal).toBe(abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    provider.destroy();
    fetch.mockRestore();
  }
});
