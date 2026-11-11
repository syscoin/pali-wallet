import { LOCAL_PASSKEY_PORT } from '../../../shared/localPasskeyTransport';

import { installLocalPasskeyControllerPorts } from './localPasskeyControllerPort';
import type { LocalPasskeyController } from '../../../wallet/localPasskeyTypes';

const extensionId = 'a'.repeat(32);
function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: (callback: (...args: any[]) => void) =>
      listeners.add(callback),
    removeListener: (callback: (...args: any[]) => void) =>
      listeners.delete(callback),
    emit: (...args: any[]) =>
      [...listeners].forEach((callback) => callback(...args)),
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(
  sender = {
    id: extensionId,
    url: `chrome-extension://${extensionId}/app.html`,
    documentId: 'document-1',
    frameId: 0,
  }
) {
  const runtime = {
    id: extensionId,
    getURL: (path: string) => `chrome-extension://${extensionId}/${path}`,
    onConnect: event(),
  };
  const port = {
    name: LOCAL_PASSKEY_PORT,
    sender,
    onMessage: event(),
    onDisconnect: event(),
    postMessage: jest.fn(),
    disconnect: jest.fn(),
  };
  let authority: { assertCurrent(): void; signal: AbortSignal };
  const controller = {
    status: jest.fn(async () => ({ enabled: true })),
    beginUnlock: jest.fn(),
    beginEnrollment: jest.fn(),
    complete: jest.fn(),
    disable: jest.fn(),
    cancel: jest.fn(),
    dispose: jest.fn(async () => undefined),
  };
  const create = jest.fn((value) => {
    authority = value;
    return controller as LocalPasskeyController;
  });
  const dispose = installLocalPasskeyControllerPorts(create, runtime as any);
  runtime.onConnect.emit(port);
  return {
    runtime,
    port,
    controller,
    create,
    dispose,
    authority: () => authority!,
  };
}
describe('local passkey document Port', () => {
  it.each([
    {
      id: extensionId,
      url: 'https://site.invalid/app.html',
      documentId: 'doc',
      frameId: 0,
    },
    {
      id: extensionId,
      url: `chrome-extension://${extensionId}/offscreen.html`,
      documentId: 'doc',
      frameId: 0,
    },
    {
      id: extensionId,
      url: `chrome-extension://${extensionId}/app.html`,
      documentId: '',
      frameId: 0,
    },
    {
      id: extensionId,
      url: `chrome-extension://${extensionId}/app.html`,
      documentId: 'doc',
      frameId: 1,
    },
  ])('refuses unowned document %p', (sender) => {
    const f = fixture(sender);
    expect(f.port.disconnect).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled();
    f.dispose();
  });
  it('keeps the same owner through prompts and retires after the final response', async () => {
    const f = fixture();
    const prompt = {
      kind: 'get',
      operationId: 'a'.repeat(32),
      ceremonyId: 'b'.repeat(32),
    };
    f.controller.beginUnlock.mockResolvedValue(prompt);
    f.controller.complete.mockResolvedValue({
      kind: 'complete',
      operationId: prompt.operationId,
      success: true,
    });
    f.port.onMessage.emit({ id: 1, method: 'beginUnlock', params: [] });
    await settle();
    expect(f.port.postMessage).toHaveBeenCalledWith({ id: 1, result: prompt });
    expect(f.port.disconnect).not.toHaveBeenCalled();
    f.port.onMessage.emit({
      id: 2,
      method: 'complete',
      params: [
        prompt.operationId,
        prompt.ceremonyId,
        {
          kind: 'get',
          rawId: 'AQ',
          clientDataJSON: 'AQ',
          authenticatorData: 'A'.repeat(50),
          signature: 'AQ',
          prfOutput: 'A'.repeat(43),
        },
      ],
    });
    await settle();
    expect(f.controller.complete).toHaveBeenCalledTimes(1);
    expect(f.authority().signal.aborted).toBe(true);
    expect(f.controller.dispose).toHaveBeenCalledTimes(1);
    f.dispose();
  });
  it('disconnect revokes a begin before its first response is available', async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.controller.beginUnlock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    f.port.onMessage.emit({ id: 1, method: 'beginUnlock', params: [] });
    f.port.onDisconnect.emit();
    expect(f.authority().signal.aborted).toBe(true);
    expect(f.controller.dispose).toHaveBeenCalledTimes(1);
    finish({ kind: 'complete', operationId: 'a'.repeat(32), success: true });
    await settle();
    expect(f.port.postMessage).not.toHaveBeenCalled();
    f.dispose();
  });
  it('refuses a concurrent command and retires both pending results', async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.controller.beginUnlock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    f.port.onMessage.emit({ id: 1, method: 'beginUnlock', params: [] });
    f.port.onMessage.emit({ id: 2, method: 'status', params: [] });
    await settle();
    expect(f.authority().signal.aborted).toBe(true);
    finish({ kind: 'complete', operationId: 'a'.repeat(32), success: true });
    await settle();
    expect(
      f.port.postMessage.mock.calls.every(
        ([message]) => message.error === 'LOCAL_PASSKEY_UNAVAILABLE'
      )
    ).toBe(true);
    f.dispose();
  });
  it('disposing the handler revokes every active document', async () => {
    const f = fixture();
    f.controller.beginUnlock.mockImplementation(
      () => new Promise(() => undefined)
    );
    f.port.onMessage.emit({ id: 1, method: 'beginUnlock', params: [] });
    f.dispose();
    expect(f.authority().signal.aborted).toBe(true);
    expect(f.port.disconnect).toHaveBeenCalledTimes(1);
  });
});
