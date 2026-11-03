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
      const { getLedgerHost } = require('./ledgerHost');
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
