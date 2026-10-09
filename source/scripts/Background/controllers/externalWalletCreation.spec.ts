import { createExternalWalletView } from './externalWalletCreation';

describe('external wallet creation admission', () => {
  const originalChrome = global.chrome;
  let contexts: any[];
  let tabs: any[];
  let create: jest.Mock;

  beforeEach(() => {
    contexts = [];
    tabs = [];
    create = jest.fn().mockResolvedValue({ id: 12 });
    global.chrome = {
      runtime: {
        id: 'pali',
        getURL: (path: string) => `chrome-extension://pali${path}`,
        getContexts: jest.fn((_filter, reply) => reply(contexts)),
      },
      tabs: { query: jest.fn((_filter, reply) => reply(tabs)) },
      storage: {
        local: {
          get: jest.fn((_filter, reply) =>
            reply({
              'pali-popup-open': true,
              'pali-popup-timestamp': Date.now(),
            })
          ),
          set: jest.fn((_data, reply) => reply()),
        },
      },
    } as unknown as typeof chrome;
  });
  afterEach(() => {
    global.chrome = originalChrome;
    jest.useRealTimers();
  });

  it('recovers immediately from a recent stale flag after abrupt hardware close', async () => {
    await expect(createExternalWalletView(create)).resolves.toEqual({ id: 12 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
  });

  it.each(['context', 'pending tab', 'routed tab'])(
    'blocks another creation with a live %s',
    async (kind) => {
      if (kind === 'context')
        contexts = [{ documentUrl: 'chrome-extension://pali/external.html' }];
      else
        tabs = [
          kind === 'pending tab'
            ? {
                pendingUrl:
                  'chrome-extension://pali/external.html?route=hardware',
              }
            : {
                url: 'chrome-extension://pali/external/settings/account/hardware',
              },
        ];
      await expect(createExternalWalletView(create)).rejects.toMatchObject({
        code: 4100,
      });
      expect(create).not.toHaveBeenCalled();
    }
  );

  it('excludes a second hardware or approval creation until the first callback settles', async () => {
    let finish!: (value: any) => void;
    create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = createExternalWalletView(create);
    await Promise.resolve();
    await expect(createExternalWalletView(create)).rejects.toMatchObject({
      code: 4100,
    });
    expect(create).toHaveBeenCalledTimes(1);
    finish({ id: 12 });
    await first;
  });

  it('blocks an existing Firefox hardware view and recovers after it closes', async () => {
    chrome.runtime.getURL = (path) => `moz-extension://internal-uuid${path}`;
    delete (chrome.runtime as any).getContexts;
    tabs = [
      {
        pendingUrl:
          'moz-extension://internal-uuid/external.html?route=settings/account/hardware',
      },
    ];
    await expect(createExternalWalletView(create)).rejects.toMatchObject({
      code: 4100,
    });
    expect(create).not.toHaveBeenCalled();
    tabs = [{ url: 'moz-extension://other-uuid/external/sign-eth' }];
    await expect(createExternalWalletView(create)).resolves.toEqual({ id: 12 });
  });

  it('releases the gate after Chrome creation fails', async () => {
    create.mockRejectedValueOnce(new Error('Chrome rejected creation'));
    await expect(createExternalWalletView(create)).rejects.toThrow(
      'Chrome rejected'
    );
    await expect(createExternalWalletView(create)).resolves.toEqual({ id: 12 });
  });

  it('does not orphan a successfully created view if the advisory flag write fails', async () => {
    (chrome.storage.local.set as jest.Mock).mockImplementation(() => {
      throw new Error('Storage failed');
    });
    await expect(createExternalWalletView(create)).resolves.toEqual({ id: 12 });
    tabs = [
      { pendingUrl: 'chrome-extension://pali/external.html?route=hardware' },
    ];
    await expect(createExternalWalletView(create)).rejects.toMatchObject({
      code: 4100,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('fails closed on browser detection errors and releases the gate for recovery', async () => {
    (chrome.tabs.query as jest.Mock).mockImplementationOnce(
      (_filter, reply) => {
        (chrome.runtime as any).lastError = { message: 'Tab query failed' };
        reply([]);
        delete (chrome.runtime as any).lastError;
      }
    );
    await expect(createExternalWalletView(create)).rejects.toMatchObject({
      code: 4100,
    });
    expect(create).not.toHaveBeenCalled();
    await expect(createExternalWalletView(create)).resolves.toEqual({ id: 12 });
  });

  it('bounds a stalled browser detection and releases the gate', async () => {
    jest.useFakeTimers();
    (chrome.runtime.getContexts as jest.Mock).mockImplementationOnce(
      () => undefined
    );
    const blocked = expect(
      createExternalWalletView(create)
    ).rejects.toMatchObject({ code: 4100 });
    await jest.advanceTimersByTimeAsync(2000);
    await blocked;
    expect(create).not.toHaveBeenCalled();
    await expect(createExternalWalletView(create)).resolves.toEqual({ id: 12 });
  });
});
