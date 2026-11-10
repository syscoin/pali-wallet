/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import React, { StrictMode } from 'react';

import { createLocalPasskeyController } from '../utils/localPasskeyController';
import { runLocalPasskeyCeremony } from '../utils/passkey/localUnlockCeremony';

import { useLocalPasskeyFlow } from './useLocalPasskeyFlow';
import type {
  LocalPasskeyController,
  LocalPasskeyPrompt,
  LocalPasskeyStep,
} from '../wallet/localPasskeyTypes';

jest.mock('../utils/passkey/localUnlockCeremony', () => ({
  runLocalPasskeyCeremony: jest.fn(),
}));
const id = 'a'.repeat(32);
const prompt = (kind: 'create' | 'get'): LocalPasskeyPrompt => ({
  kind,
  operationId: id,
  ceremonyId: 'b'.repeat(32),
  challenge: 'challenge',
  prfSalt: 'salt',
  origin: `chrome-extension://${'a'.repeat(32)}`,
  expiresAt: Date.now() + 60_000,
});
const complete: LocalPasskeyStep = {
  kind: 'complete',
  operationId: id,
  success: true,
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const controller = (): jest.Mocked<LocalPasskeyController> => ({
  beginEnrollment: jest.fn().mockResolvedValue(prompt('create')),
  beginUnlock: jest.fn().mockResolvedValue(prompt('get')),
  cancel: jest.fn().mockResolvedValue(undefined),
  dispose: jest.fn().mockResolvedValue(undefined),
  complete: jest.fn().mockResolvedValue(complete),
  disable: jest.fn().mockResolvedValue(undefined),
  status: jest.fn().mockResolvedValue({ enabled: true }),
});
beforeEach(() => {
  jest
    .mocked(runLocalPasskeyCeremony)
    .mockReset()
    .mockResolvedValue({ kind: 'get', rawId: 'raw', clientDataJSON: 'client' });
});

it('cancels a pending begin without an id, disposes on unmount, and retires a late id', async () => {
  const source = controller(),
    begin = deferred<LocalPasskeyStep>(),
    done = jest.fn();
  source.beginUnlock.mockReturnValue(begin.promise);
  const create = () => source;
  const hook = renderHook(() => useLocalPasskeyFlow(create, done));
  let pending!: Promise<boolean>;
  act(() => {
    pending = hook.result.current.unlock();
  });
  hook.unmount();
  expect(source.cancel).toHaveBeenCalledWith(undefined);
  expect(source.dispose).toHaveBeenCalledTimes(1);
  begin.resolve(prompt('get'));
  await expect(pending).resolves.toBe(false);
  expect(source.cancel).toHaveBeenCalledWith(id);
  expect(runLocalPasskeyCeremony).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

it('runs enrollment as create then get and completes exactly once', async () => {
  const source = controller(),
    done = jest.fn();
  source.complete
    .mockResolvedValueOnce(prompt('get'))
    .mockResolvedValueOnce(complete);
  const create = () => source;
  const hook = renderHook(() => useLocalPasskeyFlow(create, done));
  await act(async () => {
    expect(await hook.result.current.enroll('current-password')).toBe(true);
  });
  expect(source.beginEnrollment).toHaveBeenCalledWith('current-password');
  expect(
    jest.mocked(runLocalPasskeyCeremony).mock.calls.map(([value]) => value.kind)
  ).toEqual(['create', 'get']);
  expect(done).toHaveBeenCalledWith('enroll');
  expect(source.cancel).toHaveBeenCalledWith(id);
});

it('blocks reentrant unlock and rejects complete=false without hiding password fallback', async () => {
  const source = controller(),
    begin = deferred<LocalPasskeyStep>(),
    done = jest.fn();
  source.beginUnlock.mockReturnValue(begin.promise);
  const create = () => source;
  const hook = renderHook(() => useLocalPasskeyFlow(create, done));
  let pending!: Promise<boolean>;
  act(() => {
    pending = hook.result.current.unlock();
  });
  await act(async () => {
    expect(await hook.result.current.unlock()).toBe(false);
  });
  expect(source.beginUnlock).toHaveBeenCalledTimes(1);
  await act(async () => {
    begin.resolve({ ...complete, success: false });
    await pending;
  });
  expect(hook.result.current.error).toBe(true);
  expect(hook.result.current.busy).toBe(false);
  expect(done).not.toHaveBeenCalled();
});

it('cancel aborts a held ceremony and prevents a late completion from reaching the controller', async () => {
  const source = controller(),
    ceremony = deferred<Awaited<ReturnType<typeof runLocalPasskeyCeremony>>>();
  jest.mocked(runLocalPasskeyCeremony).mockReturnValue(ceremony.promise);
  const create = () => source;
  const hook = renderHook(() => useLocalPasskeyFlow(create));
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = hook.result.current.unlock();
    await Promise.resolve();
  });
  const signal = jest.mocked(runLocalPasskeyCeremony).mock.calls[0][1];
  act(() => hook.result.current.cancel());
  expect(signal.aborted).toBe(true);
  await act(async () => {
    ceremony.resolve({ kind: 'get', rawId: 'raw', clientDataJSON: 'client' });
    await pending;
  });
  expect(source.complete).not.toHaveBeenCalled();
  expect(hook.result.current.error).toBe(false);
});

it('disable uses the same cancellation lifetime and cannot update a replacement controller', async () => {
  const source = controller(),
    replacement = controller(),
    disabling = deferred<void>(),
    done = jest.fn();
  source.disable.mockReturnValue(disabling.promise);
  const hook = renderHook(({ create }) => useLocalPasskeyFlow(create, done), {
    initialProps: { create: () => source },
  });
  let pending!: Promise<boolean>;
  act(() => {
    pending = hook.result.current.disable('current-password');
  });
  const previous = hook.result.current;
  hook.rerender({ create: () => replacement });
  await expect(previous.unlock()).resolves.toBe(false);
  await expect(previous.status()).rejects.toThrow();
  previous.cancel();
  expect(replacement.cancel).not.toHaveBeenCalled();
  await act(async () => {
    disabling.resolve();
    await pending;
  });
  expect(done).not.toHaveBeenCalled();
  expect(source.dispose).toHaveBeenCalledTimes(1);
  expect(hook.result.current.busy).toBe(false);
});

for (const action of ['enroll', 'unlock', 'disable'] as const) {
  it(`StrictMode gives status and ${action} a fresh real controller after replay`, async () => {
    const instances: { dispose: jest.Mock; source: LocalPasskeyController }[] =
      [];
    const connections: { disconnected: boolean }[] = [];
    const originalConnect = Object.getOwnPropertyDescriptor(
      chrome.runtime,
      'connect'
    );
    Object.defineProperty(chrome.runtime, 'connect', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
    const connect = jest
      .spyOn(chrome.runtime, 'connect')
      .mockImplementation(() => {
        const messages = new Set<(message: unknown) => void>();
        const disconnections = new Set<() => void>();
        const state = { disconnected: false };
        connections.push(state);
        let enrolling = false;
        let assertions = 0;
        return {
          onMessage: {
            addListener: (fn: (message: unknown) => void) => messages.add(fn),
            removeListener: (fn: (message: unknown) => void) =>
              messages.delete(fn),
          },
          onDisconnect: {
            addListener: (fn: () => void) => disconnections.add(fn),
            removeListener: (fn: () => void) => disconnections.delete(fn),
          },
          disconnect() {
            state.disconnected = true;
            for (const fn of [...disconnections]) fn();
          },
          postMessage(message: { id: number; method: string }) {
            if (state.disconnected) throw Error('Disconnected test port');
            let result: unknown;
            if (message.method === 'status') result = { enabled: true };
            else if (message.method === 'disable') result = null;
            else if (message.method === 'beginEnrollment') {
              enrolling = true;
              result = prompt('create');
            } else if (message.method === 'beginUnlock') result = prompt('get');
            else
              result =
                enrolling && assertions++ === 0 ? prompt('get') : complete;
            queueMicrotask(() => {
              if (!state.disconnected)
                for (const fn of [...messages]) fn({ id: message.id, result });
            });
          },
        } as unknown as chrome.runtime.Port;
      });
    const create = jest.fn(() => {
      const source = createLocalPasskeyController();
      const dispose = jest.fn(() => source.dispose());
      instances.push({ source, dispose });
      return { ...source, dispose };
    });
    const done = jest.fn();
    const hook = renderHook(() => useLocalPasskeyFlow(create, done), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    try {
      expect(create).toHaveBeenCalledTimes(2);
      expect(instances[0].dispose).toHaveBeenCalledTimes(1);
      expect(instances[1].dispose).not.toHaveBeenCalled();
      await expect(instances[0].source.status()).rejects.toThrow();
      await expect(hook.result.current.status()).resolves.toEqual({
        enabled: true,
      });
      await act(async () => {
        const result =
          action === 'unlock'
            ? await hook.result.current.unlock()
            : action === 'enroll'
            ? await hook.result.current.enroll('current-password')
            : await hook.result.current.disable('current-password');
        expect(result).toBe(true);
      });
      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(action);
      expect(instances[1].dispose).not.toHaveBeenCalled();
    } finally {
      hook.unmount();
      expect(instances[1].dispose).toHaveBeenCalledTimes(1);
      expect(connections.every((value) => value.disconnected)).toBe(true);
      connect.mockRestore();
      if (originalConnect)
        Object.defineProperty(chrome.runtime, 'connect', originalConnect);
      else Reflect.deleteProperty(chrome.runtime, 'connect');
    }
  });
}
