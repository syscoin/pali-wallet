/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';

import { useSecretDisclosure } from './useSecretDisclosure';

const secret = 'synthetic-secret';
let mockScope: { account: string; network: string };
let mockStatus: {
  connectionUnavailable: boolean;
  isLoading: boolean;
  isUnlocked: boolean;
};
const mockStoreListeners = new Set<() => void>();
const mockStatusListeners = new Set<() => void>();
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    subscribe(listener: () => void) {
      mockStoreListeners.add(listener);
      return () => mockStoreListeners.delete(listener);
    },
  },
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => mockScope,
}));
jest.mock('./controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
  subscribeControllerStatus(listener: () => void) {
    mockStatusListeners.add(listener);
    return () => mockStatusListeners.delete(listener);
  },
}));
beforeEach(() => {
  mockScope = { account: 'a', network: 'n' };
  mockStatus = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
});
afterEach(() => {
  expect(mockStoreListeners.size).toBe(0);
  expect(mockStatusListeners.size).toBe(0);
});
const emitScope = () => {
  for (const listener of mockStoreListeners) listener();
};
const emitStatus = () => {
  for (const listener of mockStatusListeners) listener();
};

test('a completed authorized lookup publishes only through its current disclosure ticket', async () => {
  const view = renderHook(() => useSecretDisclosure('route', jest.fn()));
  expect(view.result.current.secret).toBeUndefined();
  let ticket!: Awaited<ReturnType<typeof view.result.current.read>>;
  await act(async () => {
    ticket = await view.result.current.read(async () => secret);
  });
  expect(view.result.current.secret).toBeUndefined();
  act(() => view.result.current.accept(ticket));
  expect(view.result.current.secret).toBe(secret);
  const current = view.result.current.isCurrent;
  act(() => view.result.current.reset());
  expect(current()).toBe(false);
  expect(view.result.current.secret).toBeUndefined();
  act(() => view.result.current.accept(ticket));
  expect(view.result.current.secret).toBeUndefined();
});

test.each(['account', 'network'] as const)(
  'a %s change away and back invalidates pending lookup and published copy authority',
  async (kind) => {
    const view = renderHook(() => useSecretDisclosure('route', jest.fn()));
    await act(async () =>
      view.result.current.accept(
        await view.result.current.read(async () => secret)
      )
    );
    const current = view.result.current.isCurrent;
    let release!: (value: string) => void;
    let pending!: ReturnType<typeof view.result.current.read>;
    act(() => {
      pending = view.result.current.read(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
    });
    const rejection = expect(pending).rejects.toThrow('CANCELLED');
    act(() => {
      const original = mockScope[kind];
      mockScope[kind] = 'other';
      emitScope();
      mockScope[kind] = original;
      emitScope();
    });
    release(secret);
    await rejection;
    expect(current()).toBe(false);
    expect(view.result.current.secret).toBeUndefined();
  }
);

test.each([
  'blur',
  'pagehide',
  'hashchange',
  'popstate',
  'lock',
  'disconnect',
  'loading',
  'unmount',
])('late lookup cannot publish after %s', async (event) => {
  const retired = jest.fn(),
    view = renderHook(() => useSecretDisclosure('route', retired));
  let release!: (value: string) => void;
  let pending!: ReturnType<typeof view.result.current.read>;
  act(() => {
    pending = view.result.current.read(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
  });
  const rejection = expect(pending).rejects.toThrow('CANCELLED');
  act(() => {
    if (event === 'unmount') view.unmount();
    else if (event === 'lock') {
      mockStatus.isUnlocked = false;
      emitStatus();
    } else if (event === 'disconnect') {
      mockStatus.connectionUnavailable = true;
      emitStatus();
    } else if (event === 'loading') {
      mockStatus.isLoading = true;
      emitStatus();
    } else window.dispatchEvent(new Event(event));
  });
  release(secret);
  await rejection;
  if (event !== 'unmount') expect(view.result.current.secret).toBeUndefined();
});

test('a different route and failed authentication never authorize a secret', async () => {
  const view = renderHook(
    ({ context }) => useSecretDisclosure(context, jest.fn()),
    { initialProps: { context: 'first' } }
  );
  let release!: (value: string) => void;
  let pending!: ReturnType<typeof view.result.current.read>;
  act(() => {
    pending = view.result.current.read(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
  });
  const rejection = expect(pending).rejects.toThrow('CANCELLED');
  view.rerender({ context: 'second' });
  release(secret);
  await rejection;
  await act(async () => {
    await expect(
      view.result.current.read(async () => {
        throw Error('bad password');
      })
    ).rejects.toThrow('bad password');
  });
  expect(view.result.current.secret).toBeUndefined();
});

test('lock refuses secret I/O and render-time drift hides an already published value', async () => {
  const view = renderHook(() => useSecretDisclosure('route', jest.fn()));
  await act(async () =>
    view.result.current.accept(
      await view.result.current.read(async () => secret)
    )
  );
  mockStatus.isUnlocked = false;
  view.rerender();
  expect(view.result.current.secret).toBeUndefined();
  const read = jest.fn(async () => secret);
  await expect(view.result.current.read(read)).rejects.toThrow('CANCELLED');
  expect(read).not.toHaveBeenCalled();
});

test('a retired route callback cannot clear or read for the newly authorized route', async () => {
  const view = renderHook(
    ({ context }) => useSecretDisclosure(context, jest.fn()),
    { initialProps: { context: 'first' } }
  );
  const oldRead = view.result.current.read;
  view.rerender({ context: 'second' });
  await act(async () =>
    view.result.current.accept(
      await view.result.current.read(async () => secret)
    )
  );
  const read = jest.fn(async () => 'old secret');
  await expect(oldRead(read)).rejects.toThrow('CANCELLED');
  expect(read).not.toHaveBeenCalled();
  expect(view.result.current.secret).toBe(secret);
});
