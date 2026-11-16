jest.mock('./providers/walletHttpIdentity', () => ({
  withWalletBackend: (_url: string, read: () => Promise<unknown>) => read(),
}));
import MainController from './MainController';

it.each([429, 503])(
  'leaves HTTP %s retries to the single SDK owner',
  async (status) => {
    jest.useFakeTimers();
    const oldFetch = global.fetch;
    const fetcher = jest.fn(async () => new Response('{}', { status }));
    global.fetch = fetcher;
    try {
      const wallet = Object.create(MainController.prototype) as MainController;
      const request = wallet.getRpc({
        url: 'https://rpc.synthetic.invalid',
      } as any);
      const rejection = expect(request).rejects.toBeDefined();
      await jest.advanceTimersByTimeAsync(8000);
      await rejection;
      expect(fetcher).toHaveBeenCalledTimes(4);
      for (const [url, init] of fetcher.mock.calls as unknown as Array<
        [string, RequestInit]
      >) {
        expect(url).toBe('https://rpc.synthetic.invalid');
        expect(JSON.parse(String(init.body)).method).toBe('eth_chainId');
      }
    } finally {
      global.fetch = oldFetch;
      jest.useRealTimers();
    }
  }
);

it('retries one transient refusal and returns the observed chain', async () => {
  jest.useFakeTimers();
  const oldFetch = global.fetch;
  const fetcher = jest.fn(async () => new Response('{}', { status: 503 }));
  fetcher.mockImplementationOnce(
    async () => new Response('{}', { status: 503 })
  );
  fetcher.mockImplementationOnce(
    async () =>
      new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', { status: 200 })
  );
  global.fetch = fetcher;
  try {
    const wallet = Object.create(MainController.prototype) as MainController;
    const request = wallet.getRpc({
      url: 'https://rpc.synthetic.invalid',
    } as any);
    await jest.advanceTimersByTimeAsync(1001);
    await expect(request).resolves.toMatchObject({ chainId: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    global.fetch = oldFetch;
    jest.useRealTimers();
  }
});
