/** @jest-environment jsdom */
import fs from 'fs';
import path from 'path';

const mockListeners: ((message: any) => void)[] = [];
const mockLanguageListeners: (() => void)[] = [];
let mockConnected = false;
let mockConfig: any;
const mockHost = {
  connect: jest.fn(async () => {
    mockConnected = true;
  }),
  disconnect: jest.fn(async () => {
    mockConnected = false;
  }),
  getStatus: () => ({ connected: mockConnected }),
  evm: { getAddress: jest.fn(async () => ({ address: 'public' })) },
  utxo: { signPsbt: jest.fn() },
};
const mockPort = {
  onMessage: { addListener: jest.fn((fn) => mockListeners.push(fn)) },
  onDisconnect: { addListener: jest.fn() },
  postMessage: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock(
  '@sidhujag/sysweb3-keyring/esm/ledger-host',
  () => ({
    createLedgerDmkHost: (config) => {
      mockConfig = config;
      return mockHost;
    },
  }),
  { virtual: true }
);
jest.mock('./i18n', () => ({
  i18next: {
    t: (key) => key,
    on: jest.fn((_event, listener) => mockLanguageListeners.push(listener)),
  },
}));

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockListeners.length = 0;
  mockLanguageListeners.length = 0;
  mockConnected = false;
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../../views/ledger.html'),
    'utf8'
  );
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
  window.location.hash = 'a'.repeat(48);
  chrome.runtime.connect = jest.fn(() => mockPort) as any;
  require('./host');
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  jest.useRealTimers();
});

it('waits for the authority before enabling device discovery and reconnects after loss', async () => {
  expect(button('connect').disabled).toBe(true);
  await mockListeners[0]({ type: 'attached' });
  button('connect').click();
  await flush();
  expect(mockHost.connect).toHaveBeenCalledWith({ useGrantedDevices: false });
  expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'ready' });
  expect(button('connect').hidden).toBe(true);
  mockConnected = false;
  jest.advanceTimersByTime(1000);
  expect(button('connect').hidden).toBe(false);
  expect(mockPort.postMessage).toHaveBeenCalledWith({
    type: 'device-disconnected',
  });
});

it('requires a fresh decision, shows exact text, and cancels consent on page departure', async () => {
  const signal = new AbortController();
  const intent = {
    kind: 'transaction',
    digest: 'exact-digest',
    unsignedTxHex: '<script>not markup</script>',
  };
  const first = mockConfig.confirmBlindSigning(intent, signal.signal);
  expect(document.getElementById('details')!.textContent).toBe(
    JSON.stringify(intent, null, 2)
  );
  expect(document.activeElement).toBe(button('cancel'));
  button('approve').click();
  await expect(first).resolves.toBe(true);
  const next = mockConfig.confirmBlindSigning(intent, signal.signal);
  window.dispatchEvent(new Event('pagehide'));
  await expect(next).resolves.toBe(false);
  expect(mockHost.disconnect).toHaveBeenCalled();
  expect(mockPort.disconnect).toHaveBeenCalledTimes(1);
});

it('revokes the visible PSBT device authority when its Port owner closes', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatch = jest.fn();
  mockHost.utxo.signPsbt.mockImplementationOnce(async (_request, owner) => {
    await held;
    owner.assertCurrent();
    dispatch();
    return { fingerprint: '01020304', signatures: [] };
  });
  const work = mockListeners[0]({
    type: 'request',
    id: 3,
    method: 'utxo.signPsbt',
    request: { psbtBase64: 'fixture' },
  });
  const [, owner] = mockHost.utxo.signPsbt.mock.calls[0];
  expect(owner.signal.aborted).toBe(false);
  window.dispatchEvent(new Event('pagehide'));
  expect(owner.signal.aborted).toBe(true);
  release();
  await work;
  expect(dispatch).not.toHaveBeenCalled();
  expect(mockPort.postMessage).not.toHaveBeenCalledWith(
    expect.objectContaining({ id: 3, ok: true })
  );
});

it('keeps long device waits alive but expires an idle window', () => {
  jest.advanceTimersByTime(20000);
  expect(mockPort.postMessage).toHaveBeenCalledWith({ type: 'heartbeat' });
  jest.advanceTimersByTime(280000);
  expect(mockPort.disconnect).toHaveBeenCalledTimes(1);
});

it('disconnects the authority immediately for an oversized malformed envelope', async () => {
  await mockListeners[0]({
    type: 'request',
    id: 1,
    request: 'a'.repeat(6 * 1024 * 1024),
  });
  expect(mockPort.disconnect).toHaveBeenCalledTimes(1);
  expect(mockHost.evm.getAddress).not.toHaveBeenCalled();
});

it('preserves current status when delayed localization arrives after cancellation', () => {
  window.dispatchEvent(new Event('pagehide'));
  expect(document.getElementById('status')!.textContent).toBe(
    'ledgerHost.disconnected'
  );
  for (const localize of mockLanguageListeners) localize();
  expect(document.getElementById('status')!.textContent).toBe(
    'ledgerHost.disconnected'
  );
  expect(button('connect').disabled).toBe(true);
});
