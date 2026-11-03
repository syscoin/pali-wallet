import { LedgerHostBroker } from './ledgerHost';

const event = () => {
  const listeners: ((...args: any[]) => void)[] = [];
  return {
    addListener: jest.fn((listener) => listeners.push(listener)),
    emit: (...args: any[]) =>
      listeners.forEach((listener) => listener(...args)),
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
