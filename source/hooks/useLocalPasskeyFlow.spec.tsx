/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';

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
  const hook = renderHook(() => useLocalPasskeyFlow(source, done));
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
  const hook = renderHook(() => useLocalPasskeyFlow(source, done));
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
  const hook = renderHook(() => useLocalPasskeyFlow(source, done));
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
  const hook = renderHook(() => useLocalPasskeyFlow(source));
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
  const hook = renderHook(({ current }) => useLocalPasskeyFlow(current, done), {
    initialProps: { current: source },
  });
  let pending!: Promise<boolean>;
  act(() => {
    pending = hook.result.current.disable('current-password');
  });
  hook.rerender({ current: replacement });
  await act(async () => {
    disabling.resolve();
    await pending;
  });
  expect(done).not.toHaveBeenCalled();
  expect(source.dispose).toHaveBeenCalledTimes(1);
  expect(hook.result.current.busy).toBe(false);
});
