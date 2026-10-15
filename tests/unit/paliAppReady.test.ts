import { expect as playwrightExpect } from '@playwright/test';

import { PaliWallet } from '../../e2e/harness/pali';

jest.mock('@playwright/test', () => ({ expect: jest.fn() }));

describe('Pali harness app readiness', () => {
  const setup = () => {
    const root = {
      first: jest.fn(),
      waitFor: jest.fn().mockResolvedValue(undefined),
    };
    root.first.mockReturnValue(root);
    const body = { waitFor: jest.fn().mockResolvedValue(undefined) };
    // An opacity-zero element still has a box, so Playwright's hidden condition
    // does not describe the actual loader CSS in app.html and external.html.
    const loader = {
      waitFor: jest.fn().mockRejectedValue(new Error('still has a box')),
    };
    const toHaveCSS = jest.fn().mockResolvedValue(undefined);
    const page = {
      locator: jest.fn((selector: string) => {
        if (selector === '#app-root, #external-root') return root;
        if (selector === 'body.app-loaded') return body;
        if (selector === '#initial-loader') return loader;
        throw new Error('unexpected readiness selector');
      }),
    };
    (playwrightExpect as unknown as jest.Mock).mockReturnValue({ toHaveCSS });
    return {
      root,
      body,
      loader,
      toHaveCSS,
      ready: () => PaliWallet.prototype.waitAppReady.call({ page }),
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it('accepts the completed opacity fade without waiting for layout invisibility', async () => {
    const { root, body, loader, toHaveCSS, ready } = setup();
    await ready();
    expect(root.waitFor).toHaveBeenCalledWith({
      state: 'attached',
      timeout: 30000,
    });
    expect(body.waitFor).toHaveBeenCalledWith({
      state: 'attached',
      timeout: 30000,
    });
    expect(playwrightExpect).toHaveBeenCalledWith(loader);
    expect(toHaveCSS).toHaveBeenCalledWith('opacity', '0', { timeout: 30000 });
    expect(loader.waitFor).not.toHaveBeenCalled();
  });

  it('does not continue before the loader fade completes', async () => {
    const { toHaveCSS, ready } = setup();
    let faded!: () => void;
    toHaveCSS.mockReturnValue(
      new Promise<void>((resolve) => {
        faded = resolve;
      })
    );
    let complete = false;
    const result = ready().then(() => {
      complete = true;
    });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(toHaveCSS).toHaveBeenCalledTimes(1);
    expect(complete).toBe(false);
    faded();
    await result;
    expect(complete).toBe(true);
  });

  it('propagates a failed fade instead of ignoring the readiness timeout', async () => {
    const { toHaveCSS, ready } = setup();
    const error = new Error('loader opacity timeout');
    toHaveCSS.mockRejectedValue(error);
    await expect(ready()).rejects.toBe(error);
  });

  it('requires app-loaded before checking the fade', async () => {
    const { body, toHaveCSS, ready } = setup();
    const error = new Error('app not loaded');
    body.waitFor.mockRejectedValue(error);
    await expect(ready()).rejects.toBe(error);
    expect(toHaveCSS).not.toHaveBeenCalled();
  });
});
