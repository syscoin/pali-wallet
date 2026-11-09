import { LedgerHostBroker } from './ledgerHost';

const event = () => {
  const listeners: ((...args: any[]) => void)[] = [];
  return {
    addListener: jest.fn((listener) => listeners.push(listener)),
    removeListener: jest.fn((listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
    emit: (...args: any[]) =>
      [...listeners].forEach((listener) => listener(...args)),
  };
};

function fixture() {
  const onConnect = event();
  const onRemoved = event();
  const api = {
    runtime: {
      id: 'pali',
      onConnect,
      getURL: (path) => `chrome-extension://pali/${path}`,
    },
    windows: {
      onRemoved,
      create: jest.fn(async (options: { url: string }) => {
        if (!options.url) throw new Error('Missing device page URL');
        return { id: 41 };
      }),
      remove: jest.fn(async () => undefined),
      update: jest.fn(async () => undefined),
    },
  };
  const broker = new LedgerHostBroker(api as any);
  const port = (overrides: any = {}) => {
    const url = api.windows.create.mock.calls[0][0].url;
    const value = {
      name: `pali-ledger-host:${url.split('#')[1]}`,
      sender: { id: 'pali', url, frameId: 0, tab: { windowId: 41 } },
      onMessage: event(),
      onDisconnect: event(),
      postMessage: jest.fn(),
      disconnect: jest.fn(),
      ...overrides,
    };
    onConnect.emit(value);
    return value;
  };
  return { api, broker, port, onRemoved };
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

it('rejects unowned device pages before lazily constructing browser device APIs', async () => {
  const original = global.chrome;
  const onConnect = event();
  const api = { runtime: { onConnect } };
  Object.defineProperty(api, 'windows', {
    get: () => {
      throw new Error('Device API touched during software startup');
    },
  });
  try {
    global.chrome = api as any;
    let host: any;
    jest.isolateModules(() => {
      const { getLedgerHost } = jest.requireActual('./ledgerHost');
      host = getLedgerHost();
      expect(getLedgerHost()).toBe(host);
    });
    expect(onConnect.addListener).toHaveBeenCalledTimes(1);
    expect(host.getStatus()).toEqual({ connected: false });
    await host.disconnect();
    const unowned = {
      name: `pali-ledger-host:${'0'.repeat(48)}`,
      disconnect: jest.fn(),
    };
    const unrelated = { name: 'pali-ordinary-page', disconnect: jest.fn() };
    onConnect.emit(unowned);
    onConnect.emit(unrelated);
    expect(unowned.disconnect).toHaveBeenCalledTimes(1);
    expect(unrelated.disconnect).not.toHaveBeenCalled();
  } finally {
    global.chrome = original;
  }
});

describe('Ledger authority host broker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('focuses an already connected owned window before dispatching the next request', async () => {
    const f = fixture();
    const connected = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connected;
    expect(f.api.windows.update).not.toHaveBeenCalled();
    const result = f.broker.host.evm.getAddress({ accountIndex: 0 });
    await flush();
    expect(f.api.windows.update).toHaveBeenCalledWith(41, { focused: true });
    const message = port.postMessage.mock.calls.find(
      ([value]) => value.type === 'request'
    )[0];
    port.onMessage.emit({
      id: message.id,
      ok: true,
      value: { address: 'public' },
    });
    await expect(result).resolves.toEqual({ address: 'public' });
    await f.broker.disconnect();
  });

  it('cancels the request when its owned window can no longer be focused', async () => {
    const f = fixture();
    const connected = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connected;
    f.api.windows.update.mockRejectedValueOnce(new Error('Window not found'));
    await expect(
      f.broker.host.evm.getAddress({ accountIndex: 0 })
    ).rejects.toMatchObject({ code: 'HARDWARE_REQUEST_CANCELLED' });
    expect(
      port.postMessage.mock.calls.filter(([value]) => value.type === 'request')
    ).toHaveLength(0);
    expect(f.broker.host.getStatus().connected).toBe(false);
  });

  it.each([
    undefined,
    {
      assertCurrent: async () => undefined,
      signal: new AbortController().signal,
    },
  ])(
    'rejects an omitted or asynchronous PSBT owner before opening the device window',
    async (owner) => {
      const f = fixture();
      const request = {
        currency: 'sys',
        slip44: 57,
        accountIndex: 0,
        accountXpub: 'fixture xpub',
        psbtBase64: 'fixture PSBT',
      };
      await expect(
        Reflect.apply(f.broker.host.utxo.signPsbt, f.broker.host.utxo, [
          request,
          owner,
        ])
      ).rejects.toMatchObject({ code: 'HARDWARE_REQUEST_CANCELLED' });
      expect(f.api.windows.create).not.toHaveBeenCalled();
    }
  );

  it.each(['evm.signTransaction', 'utxo.signPsbt'] as const)(
    'does not post %s when approval changes while focusing the device window',
    async (method) => {
      const f = fixture();
      const connected = f.broker.host.connect();
      const port = f.port();
      await flush();
      port.onMessage.emit({ type: 'ready' });
      await connected;
      let focus!: () => void;
      f.api.windows.update.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            focus = resolve;
          })
      );
      let live = true;
      const options = {
        signal: new AbortController().signal,
        assertCurrent() {
          if (!live)
            throw Object.assign(new Error('Approval expired'), {
              code: 'HARDWARE_REQUEST_CANCELLED',
            });
        },
      };
      const pending =
        method === 'evm.signTransaction'
          ? f.broker.host.evm.signTransaction(
              {
                accountIndex: 0,
                expectedAddress: `0x${'11'.repeat(20)}`,
                unsignedTxHex: 'f8',
              },
              options
            )
          : f.broker.host.utxo.signPsbt(
              {
                accountIndex: 0,
                currency: 'sys',
                slip44: 57,
                accountXpub: 'fixture xpub',
                psbtBase64: 'fixture PSBT',
              },
              options
            );
      live = false;
      focus();
      await flush();
      const posted = port.postMessage.mock.calls.find(
        ([value]) => value.type === 'request'
      );
      // If the regression dispatches, settle it so failure is immediate.
      if (posted)
        port.onMessage.emit({ id: posted[0].id, ok: true, value: {} });
      await expect(pending).rejects.toMatchObject({
        code: 'HARDWARE_REQUEST_CANCELLED',
      });
      expect(posted).toBeUndefined();
      await f.broker.disconnect();
    }
  );

  it('does not close a replacement session when an older focus request fails late', async () => {
    const f = fixture();
    const connected = f.broker.host.connect();
    const original = f.port();
    await flush();
    original.onMessage.emit({ type: 'ready' });
    await connected;
    let failFocus!: (error: Error) => void;
    f.api.windows.update.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failFocus = reject;
        })
    );
    const oldRequest = f.broker.host.evm.getAddress({ accountIndex: 0 });
    const rejected = expect(oldRequest).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await f.broker.disconnect();
    const replacementReady = f.broker.host.connect();
    const url = f.api.windows.create.mock.calls[1][0].url;
    const replacement = f.port({
      name: `pali-ledger-host:${url.split('#')[1]}`,
      sender: { id: 'pali', url, frameId: 0, tab: { windowId: 41 } },
    });
    await flush();
    replacement.onMessage.emit({ type: 'ready' });
    await replacementReady;
    failFocus(new Error('Old window disappeared'));
    await rejected;
    expect(f.broker.host.getStatus().connected).toBe(true);
    expect(replacement.disconnect).not.toHaveBeenCalled();
    await f.broker.disconnect();
  });

  it('disconnects the authenticated device port when an already posted PSBT owner aborts', async () => {
    const f = fixture();
    const connected = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connected;

    const approval = new AbortController();
    const pending = f.broker.host.utxo.signPsbt(
      {
        accountIndex: 0,
        currency: 'sys',
        slip44: 57,
        accountXpub: 'fixture xpub',
        psbtBase64: 'fixture PSBT',
      },
      { assertCurrent: () => undefined, signal: approval.signal }
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await flush();
    const [posted] = port.postMessage.mock.calls.find(
      ([value]) => value.type === 'request' && value.method === 'utxo.signPsbt'
    );
    approval.abort();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    expect(f.broker.host.getStatus().connected).toBe(false);
    port.onMessage.emit({ id: posted.id, ok: true, value: {} });
    await rejected;
  });

  it.each(['focus', 'device reply'])(
    'keeps a request waiting for %s when a sibling PSBT is cancelled',
    async (phase) => {
      const f = fixture();
      const connected = f.broker.host.connect();
      const port = f.port();
      await flush();
      port.onMessage.emit({ type: 'ready' });
      await connected;

      let finishFocus: (() => void) | undefined;
      if (phase === 'focus')
        f.api.windows.update.mockImplementationOnce(
          () =>
            new Promise<undefined>((resolve) => {
              finishFocus = () => resolve(undefined);
            })
        );
      const first = f.broker.host.evm.getAddress({ accountIndex: 0 });
      const firstResult = first.catch((error) => ({ code: error.code }));
      await flush();
      const posted = () =>
        port.postMessage.mock.calls.filter(
          ([value]) => value.type === 'request'
        );
      expect(posted()).toHaveLength(phase === 'focus' ? 0 : 1);

      const cancellation = new AbortController();
      const second = f.broker.host.utxo.signPsbt({} as never, {
        signal: cancellation.signal,
        assertCurrent: () => undefined,
      });
      const secondResult = second.catch((error) => ({ code: error.code }));
      cancellation.abort();
      finishFocus?.();
      await flush();
      const message = posted()[0]?.[0];
      if (message)
        port.onMessage.emit({
          id: message.id,
          ok: true,
          value: { address: 'public' },
        });

      try {
        await expect(firstResult).resolves.toEqual({ address: 'public' });
        await expect(secondResult).resolves.toEqual({
          code: 'HARDWARE_SIGNER_BUSY',
        });
        expect(posted()).toHaveLength(1);
        expect(f.api.windows.update).toHaveBeenCalledTimes(1);
        expect(f.api.windows.create).toHaveBeenCalledTimes(1);
        expect(port.disconnect).not.toHaveBeenCalled();
      } finally {
        await f.broker.disconnect();
      }
    }
  );

  it('cancels a joining caller without closing the initial Ledger connection', async () => {
    const f = fixture();
    const first = f.broker.host.connect();
    const firstResult = first.then(
      () => 'ready',
      (error) => error.code
    );
    const port = f.port();
    await flush();
    const cancellation = new AbortController();
    const second = f.broker.host.connect(undefined, {
      signal: cancellation.signal,
    });
    const cancelled = expect(second).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    cancellation.abort();
    await cancelled;
    port.onMessage.emit({ type: 'ready' });

    try {
      await expect(firstResult).resolves.toBe('ready');
      expect(f.api.windows.create).toHaveBeenCalledTimes(1);
      expect(f.api.windows.update).not.toHaveBeenCalled();
      expect(port.disconnect).not.toHaveBeenCalled();
    } finally {
      await f.broker.disconnect();
    }
  });

  it('rejects the current connection if its window creation fails', async () => {
    const f = fixture();
    f.api.windows.create.mockRejectedValueOnce(new Error('Cannot open window'));
    await expect(f.broker.host.connect()).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    expect(f.broker.host.getStatus().connected).toBe(false);
  });

  it('ignores a cancelled window creation that rejects after a replacement connects', async () => {
    const f = fixture();
    let failCreation!: (error: Error) => void;
    f.api.windows.create.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failCreation = reject;
        })
    );
    const original = f.broker.host.connect();
    const rejected = expect(original).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await f.broker.disconnect();
    await rejected;
    const replacementReady = f.broker.host.connect();
    const url = f.api.windows.create.mock.calls[1][0].url;
    const replacement = f.port({
      name: `pali-ledger-host:${url.split('#')[1]}`,
      sender: { id: 'pali', url, frameId: 0, tab: { windowId: 41 } },
    });
    await flush();
    replacement.onMessage.emit({ type: 'ready' });
    await replacementReady;
    failCreation(new Error('Cancelled window failed to open'));
    await flush();
    expect(f.broker.host.getStatus().connected).toBe(true);
    expect(replacement.disconnect).not.toHaveBeenCalled();
    const result = f.broker.host.evm.getAddress({ accountIndex: 0 });
    await flush();
    const request = replacement.postMessage.mock.calls.find(
      ([value]) => value.type === 'request'
    )[0];
    replacement.onMessage.emit({
      id: request.id,
      ok: true,
      value: { address: 'public' },
    });
    await expect(result).resolves.toEqual({ address: 'public' });
    await f.broker.disconnect();
  });

  it('does not let an old abort signal cancel a replacement before cleanup runs', async () => {
    const f = fixture();
    const cancellation = new AbortController();
    const original = f.broker.host.connect(undefined, {
      signal: cancellation.signal,
    });
    const rejected = expect(original).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    // Start the replacement synchronously, before the rejected operation's
    // finally block can detach its original AbortSignal listener.
    const closing = f.broker.disconnect();
    const replacementReady = f.broker.host.connect();
    const replacementResult = replacementReady.then(
      () => true,
      () => false
    );
    cancellation.abort();
    await closing;
    await rejected;
    const url = f.api.windows.create.mock.calls[1][0].url;
    const replacement = f.port({
      name: `pali-ledger-host:${url.split('#')[1]}`,
      sender: { id: 'pali', url, frameId: 0, tab: { windowId: 41 } },
    });
    await flush();
    replacement.onMessage.emit({ type: 'ready' });
    await expect(replacementResult).resolves.toBe(true);
    expect(f.broker.host.getStatus().connected).toBe(true);
    expect(replacement.disconnect).not.toHaveBeenCalled();
    await f.broker.disconnect();
  });

  it('does not open a window when pending progress synchronously aborts', async () => {
    const f = fixture();
    const cancellation = new AbortController();
    const pending = f.broker.host.connect(undefined, {
      signal: cancellation.signal,
      onProgress: ({ status }) => {
        if (status === 'pending') cancellation.abort();
      },
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    try {
      expect(f.api.windows.create).not.toHaveBeenCalled();
    } finally {
      await f.broker.disconnect();
      await rejected;
    }
  });

  it('does not join a replacement started from pending progress', async () => {
    const f = fixture();
    let replacementReady!: Promise<void>;
    const original = f.broker.host.connect(undefined, {
      onProgress: ({ status }) => {
        if (status !== 'pending') return;
        void f.broker.disconnect();
        replacementReady = f.broker.host.connect();
      },
    });
    const result = original.then(
      () => 'completed',
      (error) => error.code
    );
    expect(f.api.windows.create).toHaveBeenCalledTimes(1);
    const replacement = f.port();
    await flush();
    replacement.onMessage.emit({ type: 'ready' });
    await replacementReady;
    await expect(result).resolves.toBe('HARDWARE_REQUEST_CANCELLED');
    expect(f.broker.host.getStatus().connected).toBe(true);
    await f.broker.disconnect();
  });

  it('discards a reply if the session changes before the caller resumes', async () => {
    const f = fixture();
    const connected = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connected;
    const pending = f.broker.host.evm.getAddress({ accountIndex: 0 });
    const result = pending.then(
      () => 'completed',
      (error) => error.code
    );
    await flush();
    const request = port.postMessage.mock.calls.find(
      ([value]) => value.type === 'request'
    )[0];
    port.onMessage.emit({
      id: request.id,
      ok: true,
      value: { address: 'public' },
    });
    await f.broker.disconnect();
    await expect(result).resolves.toBe('HARDWARE_REQUEST_CANCELLED');
  });

  it.each(['abort', 'disconnect'])(
    'discards success when completed progress synchronously triggers %s',
    async (action) => {
      const f = fixture();
      const cancellation = new AbortController();
      const pending = f.broker.host.connect(undefined, {
        signal: cancellation.signal,
        onProgress: ({ status }) => {
          if (status !== 'completed') return;
          if (action === 'abort') cancellation.abort();
          else void f.broker.disconnect();
        },
      });
      const result = pending.then(
        () => 'completed',
        (error) => error.code
      );
      const port = f.port();
      await flush();
      port.onMessage.emit({ type: 'ready' });
      await expect(result).resolves.toBe('HARDWARE_REQUEST_CANCELLED');
      expect(f.broker.host.getStatus().connected).toBe(false);
      await f.broker.disconnect();
    }
  );

  it('does not dispatch into a replacement created while snapshotting a request', async () => {
    const f = fixture();
    let replacementReady!: Promise<void>;
    const pending = f.broker.host.evm.getAddress({
      toJSON() {
        void f.broker.disconnect();
        replacementReady = f.broker.host.connect();
        return { accountIndex: 0 };
      },
    } as any);
    const result = pending.then(
      () => 'completed',
      (error) => error.code
    );
    const replacement = f.port();
    await flush();
    replacement.onMessage.emit({ type: 'ready' });
    await replacementReady;
    await flush();
    try {
      expect(
        replacement.postMessage.mock.calls.filter(
          ([value]) => value.type === 'request'
        )
      ).toHaveLength(0);
      await expect(result).resolves.toBe('HARDWARE_REQUEST_CANCELLED');
      expect(f.broker.host.getStatus().connected).toBe(true);
    } finally {
      await f.broker.disconnect();
    }
  });

  it.each([
    'foreign-extension',
    'content-script',
    'subframe',
    'wrong-window',
    'wrong-nonce',
  ])('rejects a %s port before any request is sent', async (kind) => {
    const f = fixture();
    const pending = f.broker.host.connect();
    const changes: any = {};
    const url = f.api.windows.create.mock.calls[0][0].url;
    changes.sender = { id: 'pali', url, frameId: 0, tab: { windowId: 41 } };
    if (kind === 'foreign-extension') changes.sender.id = 'other';
    if (kind === 'content-script') changes.sender.url = 'https://example.com';
    if (kind === 'subframe') changes.sender.frameId = 3;
    if (kind === 'wrong-window') changes.sender.tab.windowId = 42;
    if (kind === 'wrong-nonce') changes.name = 'pali-ledger-host:incorrect';
    const port = f.port(changes);
    await flush();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    expect(port.postMessage).not.toHaveBeenCalled();
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await f.broker.disconnect();
    await rejected;
  });

  it('coalesces connection, correlates requests, snapshots parameters and rejects stale replies', async () => {
    const f = fixture();
    const first = f.broker.host.connect();
    const second = f.broker.host.connect();
    expect(f.api.windows.create).toHaveBeenCalledTimes(1);
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await Promise.all([first, second]);
    expect(f.broker.host.getStatus().connected).toBe(true);
    const params = { accountIndex: 0 };
    const pending = f.broker.host.evm.getAddress(params);
    params.accountIndex = 9;
    await flush();
    const request = port.postMessage.mock.calls.find(
      ([message]) => message.type === 'request'
    )[0];
    expect(request.request.accountIndex).toBe(0);
    port.onMessage.emit({
      id: request.id + 1,
      ok: true,
      value: 'wrong request',
    });
    port.onMessage.emit({
      id: request.id,
      ok: true,
      value: { address: '0x123', publicKey: '04' },
    });
    await expect(pending).resolves.toEqual({
      address: '0x123',
      publicKey: '04',
    });
    const next = f.broker.host.evm.getAddress({ accountIndex: 0 });
    await flush();
    const cancelled = expect(next).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await f.broker.disconnect();
    await cancelled;
    port.onMessage.emit({
      id: request.id + 1,
      ok: true,
      value: 'late approval',
    });
    expect(f.broker.host.getStatus().connected).toBe(false);
    expect(f.api.windows.remove).toHaveBeenCalledWith(41);
  });

  it('cancels immediately when the connection window closes before readiness', async () => {
    const f = fixture();
    const pending = f.broker.host.connect();
    await flush();
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    f.onRemoved.emit(41);
    await rejected;
  });

  it('expires an unanswered device request and rejects every pending result', async () => {
    const f = fixture();
    const connected = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connected;
    const request = f.broker.host.evm.getAddress({ accountIndex: 0 });
    await flush();
    const rejected = expect(request).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    jest.advanceTimersByTime(300000);
    await rejected;
    expect(port.disconnect).toHaveBeenCalled();
  });

  it('waits for explicit reconnect in the same trusted window after device loss', async () => {
    const f = fixture();
    const first = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await first;
    port.onMessage.emit({ type: 'device-disconnected' });
    expect(f.broker.host.getStatus().connected).toBe(false);
    const reconnect = f.broker.host.connect();
    expect(f.api.windows.create).toHaveBeenCalledTimes(1);
    expect(f.api.windows.update).toHaveBeenCalledWith(41, { focused: true });
    port.onMessage.emit({ type: 'ready' });
    await reconnect;
    expect(f.broker.host.getStatus().connected).toBe(true);
    await f.broker.disconnect();
  });

  it('honors AbortSignal before and during the device wait', async () => {
    const f = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(
      f.broker.host.connect(undefined, { signal: abort.signal })
    ).rejects.toMatchObject({ code: 'HARDWARE_REQUEST_CANCELLED' });
    expect(f.api.windows.create).not.toHaveBeenCalled();
    const active = new AbortController();
    const waiting = f.broker.host.connect(undefined, { signal: active.signal });
    const rejected = expect(waiting).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    active.abort();
    await rejected;
  });
});

describe('Ledger broker retirement', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function ready() {
    const f = fixture();
    const connecting = f.broker.host.connect();
    const port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connecting;
    return { ...f, port };
  }

  it('joins exact remote retirement and revokes posted operations before closing', async () => {
    const f = await ready();
    const pending = f.broker.host.evm.getAddress({ accountIndex: 0 });
    const cancelled = expect(pending).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await flush();
    const request = f.port.postMessage.mock.calls.find(
      ([value]) => value.type === 'request'
    )[0];
    const retirement = f.broker.host.retire();
    expect(f.broker.host.retire()).toBe(retirement);
    const message = f.port.postMessage.mock.calls.find(
      ([value]) => value.type === 'retire'
    )[0];
    expect(f.broker.host.getStatus().connected).toBe(false);
    expect(f.port.disconnect).not.toHaveBeenCalled();
    await expect(f.broker.host.connect()).rejects.toMatchObject({
      code: 'HARDWARE_SIGNER_BUSY',
    });
    f.port.onMessage.emit({
      id: request.id,
      ok: true,
      value: { address: 'late' },
    });
    f.port.onMessage.emit({ type: 'retired', id: message.id + 1, ok: true });
    await flush();
    expect(f.api.windows.remove).not.toHaveBeenCalled();
    f.port.onMessage.emit({ type: 'retired', id: message.id, ok: true });
    const guard = await retirement;
    await cancelled;
    expect(f.port.disconnect).toHaveBeenCalledTimes(1);
    expect(f.api.windows.remove).toHaveBeenCalledWith(41);
    expect(() => guard()).not.toThrow();
    const reopening = f.broker.host.connect();
    const rejected = expect(reopening).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    expect(() => guard()).toThrow();
    await f.broker.disconnect();
    await rejected;
  });

  it('joins late window creation after fast disconnect before returning a proof', async () => {
    const f = fixture();
    let created!: (window: { id: number }) => void;
    f.api.windows.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          created = resolve;
        })
    );
    const connecting = f.broker.host.connect();
    const cancelled = expect(connecting).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await f.broker.disconnect();
    await cancelled;
    let retired = false;
    const retirement = f.broker.host.retire().then((guard) => {
      retired = true;
      return guard;
    });
    await flush();
    expect(retired).toBe(false);
    created({ id: 73 });
    const guard = await retirement;
    expect(f.api.windows.remove).toHaveBeenCalledWith(73);
    expect(() => guard()).not.toThrow();
  });

  it.each(['failure', 'timeout', 'disconnect'] as const)(
    'refuses a proof after remote %s',
    async (mode) => {
      const f = await ready();
      const retirement = f.broker.host.retire();
      const rejected = expect(retirement).rejects.toMatchObject({
        code: 'HARDWARE_REQUEST_CANCELLED',
      });
      const message = f.port.postMessage.mock.calls.find(
        ([value]) => value.type === 'retire'
      )[0];
      if (mode === 'failure')
        f.port.onMessage.emit({ type: 'retired', id: message.id, ok: false });
      if (mode === 'timeout') jest.advanceTimersByTime(300000);
      if (mode === 'disconnect') f.port.onDisconnect.emit();
      await rejected;
      expect(f.api.windows.remove).toHaveBeenCalledWith(41);
    }
  );

  it('allows a fresh retirement only after a failed acknowledgement finishes closing its exact window', async () => {
    const f = await ready();
    let closed!: () => void;
    f.api.windows.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          closed = resolve;
        })
    );
    const retirement = f.broker.host.retire();
    const rejected = expect(retirement).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    const message = f.port.postMessage.mock.calls.find(
      ([value]) => value.type === 'retire'
    )[0];
    f.port.onMessage.emit({ type: 'retired', id: message.id, ok: false });
    await flush();
    expect(f.broker.host.retire()).toBe(retirement);
    expect(f.api.windows.remove).toHaveBeenCalledWith(41);
    closed();
    await rejected;
    const guard = await f.broker.host.retire();
    expect(() => guard()).not.toThrow();
    expect(f.api.windows.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a proof if the captured window cannot be closed', async () => {
    const f = await ready();
    f.api.windows.remove.mockRejectedValueOnce(new Error('Removal failed'));
    const retirement = f.broker.host.retire();
    const rejected = expect(retirement).rejects.toThrow('Removal failed');
    const message = f.port.postMessage.mock.calls.find(
      ([value]) => value.type === 'retire'
    )[0];
    f.port.onMessage.emit({ type: 'retired', id: message.id, ok: true });
    await rejected;
    await expect(f.broker.host.retire()).rejects.toThrow('Removal failed');
  });

  it('accepts a window already confirmed removed by the browser', async () => {
    const f = await ready();
    const retirement = f.broker.host.retire();
    const message = f.port.postMessage.mock.calls.find(
      ([value]) => value.type === 'retire'
    )[0];
    f.onRemoved.emit(41);
    f.port.onMessage.emit({ type: 'retired', id: message.id, ok: true });
    const guard = await retirement;
    expect(f.api.windows.remove).not.toHaveBeenCalled();
    expect(() => guard()).not.toThrow();
  });
});

describe.each([
  'evm.signPersonalMessage',
  'evm.signTypedData',
  'utxo.signMessage',
])('owned %s dispatch', (method) => {
  const [group, action] = method.split('.');
  it.each([
    undefined,
    {
      assertCurrent: async () => undefined,
      signal: new AbortController().signal,
    },
  ])(
    'rejects omitted/async authority before opening a device page',
    async (authority) => {
      const f = fixture();
      await expect(
        Reflect.apply(f.broker.host[group][action], f.broker.host[group], [
          {},
          authority,
        ])
      ).rejects.toMatchObject({ code: 'HARDWARE_REQUEST_CANCELLED' });
      expect(f.api.windows.create).not.toHaveBeenCalled();
    }
  );
  it('rechecks after focus and retires only its pending dispatch on abort', async () => {
    const f = fixture(),
      connected = f.broker.host.connect(),
      port = f.port();
    await flush();
    port.onMessage.emit({ type: 'ready' });
    await connected;
    let focus!: () => void;
    f.api.windows.update.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          focus = resolve;
        })
    );
    const lifetime = new AbortController();
    let current = true;
    const authority = {
      signal: lifetime.signal,
      assertCurrent() {
        if (!current)
          throw Object.assign(new Error('Retired'), {
            code: 'HARDWARE_REQUEST_CANCELLED',
          });
      },
    };
    const pending = Reflect.apply(
      f.broker.host[group][action],
      f.broker.host[group],
      [{ accountIndex: 3 }, authority]
    );
    const rejected = expect(pending).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    current = false;
    focus();
    await rejected;
    expect(
      port.postMessage.mock.calls.some(
        ([message]) => message.type === 'request'
      )
    ).toBe(false);
    current = true;
    const next = Reflect.apply(
      f.broker.host[group][action],
      f.broker.host[group],
      [{ accountIndex: 3 }, authority]
    );
    const aborted = expect(next).rejects.toMatchObject({
      code: 'HARDWARE_REQUEST_CANCELLED',
    });
    await flush();
    lifetime.abort();
    await aborted;
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  });
});
