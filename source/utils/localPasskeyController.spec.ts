import { createLocalPasskeyController } from './localPasskeyController';

const originalConnect = Object.getOwnPropertyDescriptor(
  chrome.runtime,
  'connect'
);
beforeEach(() =>
  Object.defineProperty(chrome.runtime, 'connect', {
    configurable: true,
    writable: true,
    value: jest.fn(),
  })
);

function event() {
  const listeners = new Set<(value?: any) => void>();
  return {
    addListener: (fn: (value?: any) => void) => listeners.add(fn),
    removeListener: (fn: (value?: any) => void) => listeners.delete(fn),
    emit: (value?: unknown) => [...listeners].forEach((fn) => fn(value)),
  };
}
function fixture() {
  const ports: {
    disconnect: jest.Mock;
    onDisconnect: ReturnType<typeof event>;
    onMessage: ReturnType<typeof event>;
    postMessage: jest.Mock;
  }[] = [];
  jest.spyOn(chrome.runtime, 'connect').mockImplementation(() => {
    const port = {
      onMessage: event(),
      onDisconnect: event(),
      postMessage: jest.fn(),
      disconnect: jest.fn(),
    };
    ports.push(port);
    return port as any;
  });
  return { controller: createLocalPasskeyController(), ports };
}
afterEach(() => {
  jest.restoreAllMocks();
  if (originalConnect)
    Object.defineProperty(chrome.runtime, 'connect', originalConnect);
  else delete (chrome.runtime as any).connect;
});
it('cancels the connection even before begin returns an operation id', async () => {
  const f = fixture();
  const begin = f.controller.beginUnlock();
  const rejected = expect(begin).rejects.toThrow('LOCAL_PASSKEY_UNAVAILABLE');
  await f.controller.cancel();
  await rejected;
  expect(f.ports[0].disconnect).toHaveBeenCalledTimes(1);
  await f.controller.dispose();
});
it('keeps enrollment and assertion on one port and closes after completion', async () => {
  const f = fixture();
  const first = f.controller.beginEnrollment('wallet-password');
  const port = f.ports[0];
  const operationId = 'a'.repeat(32);
  port.onMessage.emit({
    id: 1,
    result: { kind: 'create', operationId, ceremonyId: 'b'.repeat(32) },
  });
  await first;
  const next = f.controller.complete(operationId, 'b'.repeat(32), {} as any);
  port.onMessage.emit({
    id: 2,
    result: { kind: 'get', operationId, ceremonyId: 'c'.repeat(32) },
  });
  await next;
  const last = f.controller.complete(operationId, 'c'.repeat(32), {} as any);
  port.onMessage.emit({
    id: 3,
    result: { kind: 'complete', operationId, success: true },
  });
  await last;
  expect(f.ports).toHaveLength(1);
  expect(port.disconnect).toHaveBeenCalledTimes(1);
  await f.controller.dispose();
});
it('a stale operation id cannot cancel a newer begin', async () => {
  const f = fixture();
  const first = f.controller.beginUnlock();
  f.ports[0].onMessage.emit({
    id: 1,
    result: { kind: 'get', operationId: 'a'.repeat(32) },
  });
  await first;
  await f.controller.cancel('a'.repeat(32));
  const second = f.controller.beginUnlock();
  await f.controller.cancel('a'.repeat(32));
  expect(f.ports[1].disconnect).not.toHaveBeenCalled();
  f.ports[1].onMessage.emit({
    id: 1,
    result: { kind: 'get', operationId: 'b'.repeat(32) },
  });
  await second;
  await f.controller.dispose();
});
it('disposing prevents late results and future connections', async () => {
  const f = fixture();
  const begin = f.controller.beginUnlock();
  const rejected = expect(begin).rejects.toThrow();
  await f.controller.dispose();
  await rejected;
  f.ports[0].onMessage.emit({
    id: 1,
    result: { kind: 'complete', success: true },
  });
  await expect(f.controller.beginUnlock()).rejects.toThrow();
  expect(f.ports).toHaveLength(1);
});

it('a rejected old completion cannot cancel a successor operation', async () => {
  const f = fixture();
  const begin = f.controller.beginUnlock();
  f.ports[0].onMessage.emit({
    id: 1,
    result: { kind: 'get', operationId: 'a'.repeat(32) },
  });
  await begin;
  const old = f.controller.complete('a'.repeat(32), 'c'.repeat(32), {} as any);
  const rejected = expect(old).rejects.toThrow();
  await f.controller.cancel('a'.repeat(32));
  const next = f.controller.beginUnlock();
  await rejected;
  expect(f.ports[1].disconnect).not.toHaveBeenCalled();
  f.ports[1].onMessage.emit({
    id: 1,
    result: { kind: 'get', operationId: 'b'.repeat(32) },
  });
  await next;
  await f.controller.dispose();
});

it('Cancel owns an in-flight disable before its first response', async () => {
  const f = fixture();
  const disabling = f.controller.disable('wallet-password');
  const rejected = expect(disabling).rejects.toThrow();
  await f.controller.cancel();
  await rejected;
  expect(f.ports[0].disconnect).toHaveBeenCalledTimes(1);
  await f.controller.dispose();
});

it('an already-delivered old success is refused after cancel and a new begin', async () => {
  const f = fixture();
  const begin = f.controller.beginUnlock();
  f.ports[0].onMessage.emit({
    id: 1,
    result: { kind: 'get', operationId: 'a'.repeat(32) },
  });
  await begin;
  const old = f.controller.complete('a'.repeat(32), 'c'.repeat(32), {} as any);
  const rejected = expect(old).rejects.toThrow();
  f.ports[0].onMessage.emit({
    id: 2,
    result: { kind: 'complete', operationId: 'a'.repeat(32), success: true },
  });
  void f.controller.cancel('a'.repeat(32));
  const next = f.controller.beginUnlock();
  f.ports[1].onMessage.emit({
    id: 1,
    result: { kind: 'get', operationId: 'b'.repeat(32) },
  });
  await rejected;
  await next;
  expect(f.ports[1].disconnect).not.toHaveBeenCalled();
  await f.controller.dispose();
});
