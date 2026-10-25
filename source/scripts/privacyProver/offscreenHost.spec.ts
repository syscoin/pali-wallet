import { installPrivacyProverHost } from './offscreenHost';

class Event {
  listeners = new Set<any>();
  addListener = (fn: any) => {
    this.listeners.add(fn);
  };
  removeListener = (fn: any) => {
    this.listeners.delete(fn);
  };
  emit = (...args: any[]) => {
    for (const fn of this.listeners) fn(...args);
  };
}
const JOB1 = '00000000-0000-4000-8000-000000000001';
const JOB2 = '00000000-0000-4000-8000-000000000002';
const oldChrome = global.chrome;
let runtime: any, workers: any[], port: any, stop: () => void;
const background = {
  id: 'test',
  url: 'chrome-extension://test/js/background.bundle.js',
};
beforeEach(() => {
  workers = [];
  port = {
    name: 'pali-privacy-prover-v1',
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage: jest.fn(),
    disconnect: jest.fn(),
  };
  runtime = {
    id: 'test',
    getURL: (s: string) => `chrome-extension://test/${s}`,
    onMessage: new Event(),
    sendMessage: jest.fn(async () => ({ success: true })),
    connect: jest.fn(() => port),
  };
  global.chrome = { runtime } as any;
  stop = installPrivacyProverHost(
    () => {
      const worker = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
        onmessage: undefined,
        onerror: undefined,
      };
      workers.push(worker);
      return worker as any;
    },
    () => ({ port1: { close: jest.fn() }, port2: { close: jest.fn() } } as any)
  );
});
afterEach(() => {
  stop();
  global.chrome = oldChrome;
});
const connect = (id = JOB1) =>
  runtime.onMessage.emit(
    { type: 'PALI_PRIVACY_PROVER_CONNECT', id },
    background,
    jest.fn()
  );
it('accepts only the background owner before creating the private port', () => {
  runtime.onMessage.emit(
    { type: 'PALI_PRIVACY_PROVER_CONNECT', id: JOB1 },
    { id: 'test', url: 'chrome-extension://test/app.html' },
    jest.fn()
  );
  expect(runtime.connect).not.toHaveBeenCalled();
  connect();
  expect(runtime.connect).toHaveBeenCalledTimes(1);
});
it('terminates main and both subworkers on explicit wallet cancellation, then reconnects', () => {
  connect();
  port.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  expect(workers).toHaveLength(3);
  runtime.onMessage.emit(
    { type: 'PALI_PRIVACY_PROVER_CANCEL_WORKER' },
    background,
    jest.fn()
  );
  for (const worker of workers)
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(port.disconnect).toHaveBeenCalledTimes(1);
  connect();
  expect(runtime.connect).toHaveBeenCalledTimes(2);
});
it('rejects concurrent work and terminates all workers when the port disconnects', () => {
  connect();
  port.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  port.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  expect(workers).toHaveLength(3);
  expect(port.postMessage).toHaveBeenCalledWith({
    id: JOB1,
    type: 'error',
  });
  port.onDisconnect.emit();
  for (const worker of workers)
    expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('returns only matching job messages and cleans up on completion', () => {
  connect();
  port.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  workers[0].onmessage({ data: { id: 'wrong', type: 'success', result: {} } });
  expect(port.postMessage).not.toHaveBeenCalled();
  workers[0].onmessage({
    data: { id: JOB1, type: 'success', result: { proof: 'public-proof' } },
  });
  expect(port.postMessage).toHaveBeenCalledWith({
    id: JOB1,
    type: 'success',
    result: { proof: 'public-proof' },
  });
  for (const worker of workers)
    expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('does not expose native worker errors', () => {
  connect();
  port.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  workers[1].onerror({ message: 'private input' });
  expect(port.postMessage).toHaveBeenCalledWith({ id: JOB1, type: 'error' });
});

it('does not let an old disconnect cancel a replacement job', () => {
  connect();
  const old = port;
  old.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  const replacement = {
    name: 'pali-privacy-prover-v1',
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage: jest.fn(),
    disconnect: jest.fn(),
  };
  runtime.connect.mockReturnValueOnce(replacement);
  connect(JOB2);
  replacement.onMessage.emit({
    type: 'prove',
    id: JOB2,
    input: { nullifier: '3', secret: '4' },
  });
  old.onDisconnect.emit();
  for (const worker of workers.slice(0, 3))
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  for (const worker of workers.slice(3))
    expect(worker.terminate).not.toHaveBeenCalled();
});

it('ignores a queued prove from a cancelled port after reconnecting', () => {
  connect();
  const retired = port;
  runtime.onMessage.emit(
    { type: 'PALI_PRIVACY_PROVER_CANCEL_WORKER' },
    background,
    jest.fn()
  );
  const replacement = {
    name: 'pali-privacy-prover-v1',
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage: jest.fn(),
    disconnect: jest.fn(),
  };
  runtime.connect.mockReturnValueOnce(replacement);
  connect(JOB2);
  retired.onMessage.emit({
    type: 'prove',
    id: JOB1,
    input: { nullifier: '1', secret: '2' },
  });
  expect(workers).toHaveLength(0);
  expect(retired.postMessage).not.toHaveBeenCalled();
});

it('ignores a queued cancel from a retired port while a replacement proof runs', () => {
  connect();
  const retired = port;
  const replacement = {
    name: 'pali-privacy-prover-v1',
    onMessage: new Event(),
    onDisconnect: new Event(),
    postMessage: jest.fn(),
    disconnect: jest.fn(),
  };
  runtime.connect.mockReturnValueOnce(replacement);
  connect(JOB2);
  replacement.onMessage.emit({
    type: 'prove',
    id: JOB2,
    input: { nullifier: '3', secret: '4' },
  });
  retired.onMessage.emit({ type: 'cancel' });
  expect(workers).toHaveLength(3);
  for (const worker of workers) expect(worker.terminate).not.toHaveBeenCalled();
});

it('rejects invalid connection UUIDs without replacing a live port', () => {
  connect();
  runtime.onMessage.emit(
    { type: 'PALI_PRIVACY_PROVER_CONNECT', id: 'invalid' },
    background,
    jest.fn()
  );
  expect(runtime.connect).toHaveBeenCalledTimes(1);
  expect(port.disconnect).not.toHaveBeenCalled();
});

it('announces READY after registering its command listener and answers existing-host queries', () => {
  expect(runtime.onMessage.listeners.size).toBe(1);
  expect(runtime.sendMessage).toHaveBeenCalledWith({
    type: 'PALI_PRIVACY_PROVER_READY',
    version: 1,
  });
  runtime.sendMessage.mockClear();
  runtime.onMessage.emit(
    { type: 'PALI_PRIVACY_PROVER_READY_QUERY' },
    background,
    jest.fn()
  );
  expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(runtime.connect).not.toHaveBeenCalled();
});
