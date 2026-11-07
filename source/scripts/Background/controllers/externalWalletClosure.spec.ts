import { hasExternalWalletPage } from 'utils/extensionContexts';

import { waitForExternalWalletClosure } from './externalWalletCreation';

jest.mock('utils/extensionContexts', () => ({
  hasExternalWalletPage: jest.fn(),
}));

const check = jest.mocked(hasExternalWalletPage);

describe('account-switch popup handoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    check.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('waits for the old live view to disappear before continuing', async () => {
    check.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    let continued = false;
    const pending = waitForExternalWalletClosure().then(() => {
      continued = true;
    });
    await Promise.resolve();
    expect(continued).toBe(false);
    await jest.advanceTimersByTimeAsync(25);
    await pending;
    expect(continued).toBe(true);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the view remains open until the deadline', async () => {
    check.mockResolvedValue(true);
    const pending = waitForExternalWalletClosure(undefined, 50);
    const rejected = expect(pending).rejects.toMatchObject({
      code: 4100,
      message: 'Dapp already has a open window',
    });
    await jest.advanceTimersByTimeAsync(50);
    await rejected;
  });

  it('fails closed on a browser context query error', async () => {
    check.mockRejectedValue(new Error('Window query unavailable'));
    await expect(waitForExternalWalletClosure()).rejects.toMatchObject({
      code: 4100,
      message: 'Could not check wallet windows',
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('does not continue if cancellation races with a clear result', async () => {
    let finish!: (value: boolean) => void;
    check.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const abort = new AbortController();
    const pending = waitForExternalWalletClosure(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    abort.abort();
    finish(false);
    await rejected;
  });

  it('stops a pending wait when the original request aborts', async () => {
    check.mockResolvedValue(true);
    const abort = new AbortController();
    const pending = waitForExternalWalletClosure(abort.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 4001 });
    await Promise.resolve();
    abort.abort();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });
});
