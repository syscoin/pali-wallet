/** @jest-environment jsdom */
/* eslint-disable @typescript-eslint/no-var-requires */

export {};

const originalChannel = process.env.PALI_EXTENSION_CHANNEL;
const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];

beforeEach(() => {
  jest.resetModules();
  document.head.innerHTML = '';
  window.history.replaceState(null, '', '/channel-test.html');
  const add = window.addEventListener.bind(window);
  jest
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener, options) => {
      if (listener) listeners.push([type, listener]);
      add(type, listener, options);
    });
  jest.spyOn(window, 'postMessage').mockImplementation((data: any) => {
    window.dispatchEvent(new MessageEvent('message', { data, source: window }));
  });
  jest.spyOn(console, 'log').mockImplementation();
});

afterEach(() => {
  for (const [type, listener] of listeners.splice(0))
    window.removeEventListener(type, listener);
  jest.restoreAllMocks();
  if (originalChannel === undefined) delete process.env.PALI_EXTENSION_CHANNEL;
  else process.env.PALI_EXTENSION_CHANNEL = originalChannel;
  for (const key of Object.keys(window))
    if (key.includes('paliContentScriptInitialized'))
      delete (window as any)[key];
});

function install(channel: 'stable' | 'canary', hold = false, ethereum = false) {
  process.env.PALI_EXTENSION_CHANNEL = channel;
  const send = jest.fn((message, reply) => {
    if (message.action === 'isInjected') reply({ isInjected: false });
    else if (message.data?.method === 'wallet_getProviderState')
      reply({
        accounts: [],
        chainId: '0x1',
        isBitcoinBased: false,
        isUnlocked: true,
      });
    else if (!hold) reply(`${channel} result`);
  });
  jest.doMock('./backgroundMessaging', () => ({ sendToBackground: send }));
  let Provider: any;
  const runtime = {
    id: channel,
    getURL: (file: string) => `chrome-extension://${channel}/${file}`,
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
  };
  jest.isolateModules(() => {
    Object.assign(chrome.runtime, runtime);
    require('./index');
    Provider = ethereum
      ? require('./inject/paliProviderEthereum').PaliInpageProviderEth
      : require('./inject/BaseProvider').BaseProvider;
  });
  send.mockClear();
  const listener = runtime.onMessage.addListener.mock.calls[0][0];
  const receive = (...args: unknown[]) => {
    // Each real extension has its own runtime object in its isolated world.
    Object.assign(chrome.runtime, runtime);
    return listener(...args);
  };
  return {
    send,
    receive,
    provider: ethereum ? new Provider() : new Provider('ethereum'),
  };
}

it.each(['stable', 'canary'] as const)(
  'sends a %s provider request to only its matching extension',
  async (channel) => {
    const stable = install('stable');
    const canary = install('canary');
    const chosen = channel === 'stable' ? stable : canary;
    const other = channel === 'stable' ? canary : stable;
    await expect(
      chosen.provider.request({ method: 'fixture_read' })
    ).resolves.toBe(`${channel} result`);
    expect(chosen.send).toHaveBeenCalledTimes(1);
    expect(other.send).not.toHaveBeenCalled();
    expect(chosen.send.mock.calls[0][0].type).toBe('METHOD_REQUEST');
    expect((window.postMessage as jest.Mock).mock.calls.at(-1)[0].type).toBe(
      channel === 'stable' ? 'METHOD_REQUEST' : 'pali-canary:METHOD_REQUEST'
    );
  }
);

it('keeps concurrent equal local IDs and replies separate', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(123);
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  const stable = install('stable', true);
  const canary = install('canary', true);
  const stableResult = stable.provider.request({ method: 'fixture_read' });
  const canaryResult = canary.provider.request({ method: 'fixture_read' });
  expect(stable.send).toHaveBeenCalledTimes(1);
  expect(canary.send).toHaveBeenCalledTimes(1);
  canary.send.mock.calls[0][1]('canary result');
  stable.send.mock.calls[0][1]('stable result');
  await expect(stableResult).resolves.toBe('stable result');
  await expect(canaryResult).resolves.toBe('canary result');
});

it('ignores same-ID replies from a permissive older unnamespaced bridge', async () => {
  const oldReply = (event: MessageEvent) => {
    if (event.source !== window || !event.data?.id) return;
    window.dispatchEvent(
      new CustomEvent(event.data.id, {
        detail: JSON.stringify({
          error: { code: -32601, message: 'Unknown method' },
        }),
      })
    );
  };
  window.addEventListener('message', oldReply);
  const canary = install('canary');
  await expect(
    canary.provider.request({ method: 'fixture_read' })
  ).resolves.toBe('canary result');
  expect(canary.send).toHaveBeenCalledTimes(1);
});

it('rejects cross-channel and privileged wire types before either background', () => {
  const stable = install('stable');
  const canary = install('canary');
  for (const type of [
    'CONTROLLER_ACTION',
    'pali-canary:CONTROLLER_ACTION',
    'pali-canary:pali-canary:METHOD_REQUEST',
  ]) {
    window.postMessage({ id: 'bad', type, data: {} }, window.location.origin);
  }
  expect(stable.send).not.toHaveBeenCalled();
  expect(canary.send).not.toHaveBeenCalled();
});

it('keeps account and lock notifications in the originating provider', async () => {
  const stable = install('stable', false, true);
  const canary = install('canary', false, true);
  await Promise.resolve();
  await Promise.resolve();
  const address = `0x${'11'.repeat(20)}`;
  const notify = (name: string, method: string, params: unknown) =>
    window.dispatchEvent(
      new CustomEvent(name, { detail: JSON.stringify({ method, params }) })
    );
  notify('pali-canary:paliNotification', 'pali_accountsChanged', [address]);
  expect(canary.provider.selectedAddress).toBe(address);
  expect(stable.provider.selectedAddress).toBeNull();
  notify('paliNotification', 'pali_accountsChanged', [address]);
  notify('pali-canary:paliNotification', 'pali_unlockStateChanged', {
    isUnlocked: false,
  });
  expect(canary.provider.selectedAddress).toBeNull();
  expect(stable.provider.selectedAddress).toBe(address);
});

it("does not remove or skip the other installation's injected scripts", () => {
  const stable = install('stable');
  const canary = install('canary');
  const toggle = (
    receive: (...args: unknown[]) => unknown,
    enabled: boolean
  ) => {
    const method = enabled ? 'pali_addProperty' : 'pali_removeProperty';
    receive(
      { id: method, data: { method, params: { type: method } } },
      {},
      jest.fn()
    );
  };
  toggle(stable.receive, true);
  toggle(canary.receive, true);
  expect(document.getElementById('inpage')?.getAttribute('src')).toBe(
    'chrome-extension://stable/js/inpage.bundle.js'
  );
  expect(
    document.getElementById('pali-canary:inpage')?.getAttribute('src')
  ).toBe('chrome-extension://canary/js/inpage.bundle.js');
  toggle(canary.receive, false);
  expect(document.getElementById('inpage')).not.toBeNull();
  expect(document.getElementById('pali-canary:inpage')).toBeNull();
});
