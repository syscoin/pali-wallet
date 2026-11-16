jest.mock('syscoinjs-lib', () => ({
  utils: jest.requireActual('syscoinjs-lib/utils'),
}));

import { clearFetchBackendAccountCache } from '../utils/fetchBackendAccountWrapper';

import SyscoinBalanceController from './syscoin';

it('keeps another balance subscriber alive and cancels physical work after the last leaves', async () => {
  const original = global.fetch;
  let finish!: (value: Response) => void;
  let physical!: AbortSignal;
  global.fetch = jest.fn(async (_url, init) => {
    physical = init?.signal as AbortSignal;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const first = new AbortController(),
    second = new AbortController();
  const account = { xpub: 'zpub-ownership', address: 'unused' } as any;
  const read = (controller: AbortController) =>
    SyscoinBalanceController().getSysBalanceForAccount(
      account,
      'https://blockbook.invalid/',
      {
        signal: controller.signal,
        assertCurrent() {
          if (controller.signal.aborted)
            throw Object.assign(new Error('Retired'), { name: 'AbortError' });
        },
      }
    );
  try {
    const a = read(first),
      b = read(second);
    const rejectA = expect(a).rejects.toHaveProperty('name', 'AbortError');
    const rejectB = expect(b).rejects.toHaveProperty('name', 'AbortError');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    first.abort();
    await rejectA;
    expect(physical.aborted).toBe(false);
    second.abort();
    await rejectB;
    expect(physical.aborted).toBe(true);
    finish(Response.json({ balance: '0', unconfirmedBalance: '0' }));
  } finally {
    clearFetchBackendAccountCache();
    global.fetch = original;
  }
});
