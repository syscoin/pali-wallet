import { SMART_ACCOUNT_CONTROLLER_PORT } from '../../../shared/smartAccountControllerAuthority';
import { SMART_ACCOUNT_EXECUTION_LIFETIME_MS } from '../../../utils/smartAccount/prepareOperation';

import { handleMasterControllerResponses } from './handleMasterControllerResponses';

const methods = [
  'signSmartAccountPreparedOwner',
  'registerSmartAccountOnChain',
  'submitSmartAccountExecution',
] as const;
function event<T extends (...args: any[]) => unknown>() {
  const listeners = new Set<T>();
  return {
    addListener: (listener: T) => listeners.add(listener),
    removeListener: (listener: T) => listeners.delete(listener),
    emit: (...args: Parameters<T>) => {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}
const sender = () => ({
  id: 'pali',
  frameId: 0,
  documentId: 'actual-browser-document',
  url: 'chrome-extension://pali/app.html#/send/confirm',
});
const tick = () => new Promise(setImmediate);
function connect(source: unknown = sender()) {
  const onMessage = event<(value: unknown) => void>();
  const onDisconnect = event<() => void>();
  const port = {
    name: SMART_ACCOUNT_CONTROLLER_PORT,
    sender: source,
    onMessage,
    onDisconnect,
    postMessage: jest.fn(),
    disconnect: jest.fn(() => onDisconnect.emit()),
  };
  (chrome.runtime.onConnect.addListener as jest.Mock).mock.calls.at(-1)[0](
    port
  );
  return port;
}
const request = (method: string, params?: unknown[]) => ({
  type: 'CONTROLLER_ACTION',
  data: {
    methods: ['wallet', method],
    params:
      params ??
      (method === 'signSmartAccountPreparedOwner'
        ? ['prepared-context', { id: 4, type: 'Ledger' }]
        : [{}]),
  },
});
let operation: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  operation = jest.fn(async () => ({ hash: 'acknowledged' }));
  Object.assign(chrome.runtime, {
    id: 'pali',
    getURL: (path = '') => `chrome-extension://pali/${path}`,
  });
  handleMasterControllerResponses({
    wallet: Object.fromEntries(methods.map((method) => [method, operation])),
  } as any);
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => {
  // Replacing the controller retires every held Port and deadline.
  handleMasterControllerResponses({ wallet: {} } as any);
  jest.useRealTimers();
  jest.restoreAllMocks();
});
it.each(methods)(
  'injects real document authority for %s, then closes only that call',
  async (method) => {
    const port = connect();
    port.onMessage.emit(request(method));
    await tick();
    const authority = operation.mock.calls[0].at(-1);
    expect(authority.kind).toBe('document');
    expect(typeof authority.assertCurrent).toBe('function');
    expect(authority.signal.aborted).toBe(true);
    expect(port.postMessage).toHaveBeenCalledWith({ hash: 'acknowledged' });
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    const next = connect();
    next.onMessage.emit(request(method));
    await tick();
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[1].at(-1).signal).not.toBe(authority.signal);
    expect(next.postMessage).toHaveBeenCalledWith({ hash: 'acknowledged' });
  }
);
it.each(methods)(
  'refuses the old one-shot onMessage route for %s',
  async (method) => {
    const reply = jest.fn();
    const listener = (
      chrome.runtime.onMessage.addListener as jest.Mock
    ).mock.calls.at(-1)[0];
    expect(listener(request(method), sender(), reply)).toBe(false);
    await tick();
    expect(operation).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  }
);
it.each([
  { ...sender(), id: 'another-extension' },
  { ...sender(), url: 'https://dapp.invalid/app.html' },
  { ...sender(), url: 'chrome-extension://pali/other.html' },
  { ...sender(), frameId: -1 },
  { ...sender(), documentId: '' },
])('refuses unclassified browser sources %j', async (source) => {
  const port = connect(source);
  port.onMessage.emit(request('signSmartAccountPreparedOwner'));
  await tick();
  expect(operation).not.toHaveBeenCalled();
  expect(port.disconnect).toHaveBeenCalledTimes(1);
});
it('accepts an actual Firefox Port without a Chrome-only documentId', async () => {
  const source: chrome.runtime.MessageSender = sender();
  delete source.documentId;
  const port = connect(source);
  port.onMessage.emit(request('signSmartAccountPreparedOwner'));
  await tick();
  expect(operation).toHaveBeenCalledTimes(1);
  expect(port.postMessage).toHaveBeenCalledWith({ hash: 'acknowledged' });
});
it.each([
  request('signSmartAccountPreparedOwner', [
    'context',
    {},
    { kind: 'document' },
  ]),
  request('submitSmartAccountExecution', [{}, { assertCurrent: true }]),
  request('getActiveKeyring'),
  {
    type: 'CONTROLLER_ACTION',
    data: { methods: ['wallet', 'constructor'], params: [] },
  },
])(
  'never forwards arbitrary calls or renderer authority %j',
  async (message) => {
    const port = connect();
    port.onMessage.emit(message);
    await tick();
    expect(operation).not.toHaveBeenCalled();
    expect(port.disconnect).toHaveBeenCalledTimes(1);
  }
);
it.each(methods)(
  'retires held %s work when its actual Port disconnects',
  async (method) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatch = jest.fn();
    operation.mockImplementationOnce(async (...args) => {
      const authority = args.at(-1);
      authority.assertCurrent();
      await held;
      expect(authority.signal.aborted).toBe(true);
      authority.assertCurrent();
      return dispatch();
    });
    const port = connect();
    port.onMessage.emit(request(method));
    await tick();
    port.onDisconnect.emit();
    release();
    await tick();
    expect(dispatch).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
  }
);
it('expires a held owner approval without dispatching or returning its proof', async () => {
  jest.useFakeTimers();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  operation.mockImplementationOnce(async (...args) => {
    await held;
    args.at(-1).assertCurrent();
    return 'late-proof';
  });
  const port = connect();
  port.onMessage.emit(request('signSmartAccountPreparedOwner'));
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(SMART_ACCOUNT_EXECUTION_LIFETIME_MS);
  release();
  await jest.advanceTimersByTimeAsync(0);
  expect(operation.mock.calls[0].at(-1).signal.aborted).toBe(true);
  expect(port.postMessage).not.toHaveBeenCalled();
});
it('keeps financial finalization independent after handoff while a dead Port receives no reply', async () => {
  let acknowledge!: (value: unknown) => void;
  const handedOff = new Promise((resolve) => {
    acknowledge = resolve;
  });
  const finalize = jest.fn();
  operation.mockImplementationOnce(async (_params, authority) => {
    authority.assertCurrent();
    const result = await handedOff;
    finalize(result);
    return result;
  });
  const port = connect();
  port.onMessage.emit(request('submitSmartAccountExecution'));
  await tick();
  port.onDisconnect.emit();
  acknowledge({ hash: 'accepted-before-document-retired' });
  await tick();
  expect(finalize).toHaveBeenCalledWith({
    hash: 'accepted-before-document-retired',
  });
  expect(port.postMessage).not.toHaveBeenCalled();
  expect(operation).toHaveBeenCalledTimes(1);
});
