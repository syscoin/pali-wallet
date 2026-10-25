import { webcrypto } from 'crypto';

import { cancelPrivacyProof, runPrivacyProof } from './prover';
import fixture from './prover.fixture.json';
import { privacyPublicSignals } from './proverCore';

jest.mock('utils/slhDsa/offscreenClient', () => ({
  ensureOffscreenDocument: jest.fn(async () => undefined),
}));

class Event<T extends (...args: any[]) => void> {
  listeners = new Set<T>();
  addListener = (listener: T) => {
    this.listeners.add(listener);
  };
  removeListener = (listener: T) => {
    this.listeners.delete(listener);
  };
  emit = (...args: Parameters<T>) => {
    for (const listener of this.listeners) listener(...args);
  };
}
const originalChrome = global.chrome,
  originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
let connected: (port: any) => void,
  readyListener: (...args: any[]) => void,
  port: any,
  sent: any[];
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  sent = [];
  port = {
    name: 'pali-privacy-prover-v1',
    sender: { id: 'test', url: 'chrome-extension://test/offscreen.html' },
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage: jest.fn((value) => sent.push(structuredClone(value))),
    disconnect: jest.fn(),
  };
  global.chrome = {
    runtime: {
      id: 'test',
      getURL: (s: string) => `chrome-extension://test/${s}`,
      onMessage: {
        addListener: (listener: any) => {
          readyListener = listener;
        },
      },
      onConnect: {
        addListener: (listener: any) => {
          connected = listener;
        },
      },
      sendMessage: jest.fn(async (request: any) => {
        if (request.type === 'PALI_PRIVACY_PROVER_READY_QUERY') {
          readyListener(
            { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
            port.sender,
            jest.fn()
          );
          return { success: true };
        }
        port.name = `pali-privacy-prover-v1:${request.id}`;
        connected(port);
        return { success: true };
      }),
    },
  } as any;
});
afterEach(() => {
  cancelPrivacyProof();
  global.chrome = originalChrome;
  if (originalCrypto)
    Object.defineProperty(globalThis, 'crypto', originalCrypto);
  jest.restoreAllMocks();
});
const answer = () =>
  port.onMessage.emit({
    id: sent[0].id,
    type: 'success',
    result: {
      proof: `0x${'01'.repeat(256)}`,
      publicSignals: privacyPublicSignals(fixture.input),
    },
  });
it('uses private port for secrets and broadcasts only a public connection request', async () => {
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  await flush();
  answer();
  await expect(job).resolves.toMatchObject({ proof: expect.any(String) });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
    type: 'PALI_PRIVACY_PROVER_CONNECT',
    id: sent[0].id,
  });
  expect(sent[0].input.nullifier).toBe(fixture.input.nullifier);
  expect(port.disconnect).toHaveBeenCalled();
});
it('allows only one active proof', async () => {
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  await flush();
  await expect(
    runPrivacyProof(fixture.input, { assertCurrent: () => undefined })
  ).rejects.toThrow('privacy_proof_busy');
  answer();
  await job;
});
it('cancels an active proof and disconnects all host work', async () => {
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  const rejected = expect(job).rejects.toThrow('privacy_proof_cancelled');
  await flush();
  cancelPrivacyProof();
  await rejected;
  expect(port.disconnect).toHaveBeenCalled();
  expect(sent.at(-1)).toEqual({ type: 'cancel' });
});
it('rejects a delayed reply after wallet-session ownership changes', async () => {
  let current = true;
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => {
      if (!current) throw Error('changed');
    },
  });
  const rejected = expect(job).rejects.toThrow();
  await flush();
  current = false;
  answer();
  await rejected;
});
it('rejects altered public signals from the worker', async () => {
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  const rejected = expect(job).rejects.toThrow('privacy_proof_failed');
  await flush();
  port.onMessage.emit({
    id: sent[0].id,
    type: 'success',
    result: {
      proof: `0x${'01'.repeat(256)}`,
      publicSignals: Array(6).fill('0'),
    },
  });
  await rejected;
});
it('cancels before any private payload when already aborted', async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    runPrivacyProof(fixture.input, {
      assertCurrent: () => undefined,
      signal: abort.signal,
    })
  ).rejects.toThrow('privacy_proof_cancelled');
  expect(sent).toEqual([]);
});

it('rejects a late cancelled handshake without consuming the replacement waiter', async () => {
  const requests: any[] = [];
  jest.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: any
  ) => {
    if (request.type === 'PALI_PRIVACY_PROVER_READY_QUERY')
      readyListener(
        { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
        port.sender,
        jest.fn()
      );
    else requests.push(request);
    return Promise.resolve({ success: true });
  }) as any);
  const first = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  const firstRejected = expect(first).rejects.toThrow(
    'privacy_proof_cancelled'
  );
  await flush();
  cancelPrivacyProof();
  await firstRejected;
  const second = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  void second.catch(() => undefined);
  await flush();
  const makePort = (request: any) => ({
    name: request.id
      ? `pali-privacy-prover-v1:${request.id}`
      : 'pali-privacy-prover-v1',
    sender: { id: 'test', url: 'chrome-extension://test/offscreen.html' },
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage: jest.fn(),
    disconnect: jest.fn(),
  });
  const retired = makePort(requests[0]);
  const current = makePort(requests[1]);
  connected(retired);
  expect(retired.disconnect).toHaveBeenCalledTimes(1);
  expect(retired.postMessage).not.toHaveBeenCalled();
  connected(current);
  await flush();
  const submitted = current.postMessage.mock.calls[0][0];
  current.onMessage.emit({
    id: submitted.id,
    type: 'success',
    result: {
      proof: `0x${'01'.repeat(256)}`,
      publicSignals: privacyPublicSignals(fixture.input),
    },
  });
  await expect(second).resolves.toHaveProperty('proof');
  expect(current.disconnect).toHaveBeenCalledTimes(1);
});

it('waits for authenticated startup READY when the first receiver is not installed yet', async () => {
  jest.mocked(chrome.runtime.sendMessage).mockImplementation((async (
    request: any
  ) => {
    if (request.type === 'PALI_PRIVACY_PROVER_READY_QUERY')
      throw Error(
        'Could not establish connection. Receiving end does not exist.'
      );
    port.name = `pali-privacy-prover-v1:${request.id}`;
    connected(port);
    return { success: true };
  }) as any);
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  await flush();
  expect(sent).toEqual([]);
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  readyListener(
    { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
    port.sender,
    jest.fn()
  );
  await flush();
  answer();
  await expect(job).resolves.toHaveProperty('proof');
});

it('ignores forged and duplicate READY messages without duplicating CONNECT', async () => {
  const requests: any[] = [];
  jest.mocked(chrome.runtime.sendMessage).mockImplementation((async (
    request: any
  ) => {
    requests.push(request);
    return { success: true };
  }) as any);
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  void job.catch(() => undefined);
  await flush();
  readyListener(
    { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
    { id: 'test', url: 'chrome-extension://test/app.html' },
    jest.fn()
  );
  expect(
    requests.filter((r) => r.type === 'PALI_PRIVACY_PROVER_CONNECT')
  ).toHaveLength(0);
  readyListener(
    { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
    port.sender,
    jest.fn()
  );
  readyListener(
    { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
    port.sender,
    jest.fn()
  );
  await flush();
  const connects = requests.filter(
    (r) => r.type === 'PALI_PRIVACY_PROVER_CONNECT'
  );
  expect(connects).toHaveLength(1);
  port.name = `pali-privacy-prover-v1:${connects[0].id}`;
  connected(port);
  await flush();
  answer();
  await job;
});

it('does not connect after cancellation while awaiting readiness', async () => {
  jest
    .mocked(chrome.runtime.sendMessage)
    .mockRejectedValue(Error('Receiving end does not exist.'));
  const job = runPrivacyProof(fixture.input, {
    assertCurrent: () => undefined,
  });
  const failed = expect(job).rejects.toThrow('privacy_proof_cancelled');
  await flush();
  cancelPrivacyProof();
  await failed;
  readyListener(
    { type: 'PALI_PRIVACY_PROVER_READY', version: 1 },
    port.sender,
    jest.fn()
  );
  await flush();
  expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([]);
});

it('bounds a missing readiness event without retrying the query', async () => {
  jest.useFakeTimers();
  try {
    jest
      .mocked(chrome.runtime.sendMessage)
      .mockRejectedValue(Error('Receiving end does not exist.'));
    const job = runPrivacyProof(fixture.input, {
      assertCurrent: () => undefined,
    });
    const failed = expect(job).rejects.toThrow('privacy_proof_unavailable');
    await flush();
    jest.advanceTimersByTime(10001);
    await failed;
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});
