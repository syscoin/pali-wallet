/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import ExternalAddRPC from './ExternalAddRPC';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const rpc = 'https://first-rpc.invalid';
const api = 'https://first-api.invalid';
const network = {
  chainId: 1337,
  kind: 'ethereum',
  label: 'Validation race network',
  url: rpc,
  currency: 'test',
  explorer: 'https://explorer.invalid',
  apiUrl: api,
  slip44: 60,
};

jest.mock('hooks/index', () => ({
  useQueryData: jest.requireActual('hooks/useQuery').useQueryData,
  useUtils: () => ({ alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({
  extractErrorMessage: (error: Error, fallback: string) =>
    error.message || fallback,
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const input = (field: 'url' | 'apiUrl' | 'chainId') =>
  document.querySelector<HTMLInputElement>('#rpc_' + field)!;
const calls = (method: string) =>
  mockEmitter.mock.calls.filter(([[, name]]) => name === method);
const mount = (chainId = 1337) =>
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/external/add-EthChain',
          search: `?data=${encodeURIComponent(
            JSON.stringify({
              host: 'https://requesting-dapp.invalid',
              eventName: 'wallet_addEthereumChain',
              chainConfig: {
                chainId,
                chainName: network.label,
                rpcUrls: [rpc],
                nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 },
                blockExplorerUrls: [network.explorer],
                apiUrl: api,
              },
            })
          )}`,
        },
      ]}
    >
      <ExternalAddRPC />
    </MemoryRouter>
  );
const originalMessageChannel = globalThis.MessageChannel;
beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(window, 'close').mockImplementation();
  mockEmitter
    .mockReset()
    .mockImplementation(async ([, method], [params] = []) => {
      if (method === 'getRpc') return { ...network, url: params.url };
      if (method === 'testExplorerApi') return { success: true };
      return undefined;
    });
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ['url', 'getRpc'],
  ['apiUrl', 'testExplorerApi'],
] as const)('%s validation response order', (field, method) => {
  const response = (valid: boolean) =>
    field === 'url'
      ? { ...network, chainId: valid ? 1337 : 1338 }
      : { success: valid, error: valid ? undefined : 'Current API rejected' };
  const errorText =
    field === 'url' ? 'settings.chainIdMismatch' : 'Current API rejected';

  it.each([true, false])(
    'keeps the latest result when an older response arrives (older valid=%s)',
    async (oldValid) => {
      const old = deferred<any>();
      const normal = mockEmitter.getMockImplementation()!;
      let requests = 0;
      mockEmitter.mockImplementation((path, args) => {
        if (path[1] !== method) return normal(path, args);
        return ++requests === 1
          ? old.promise
          : Promise.resolve(response(!oldValid));
      });
      mount();
      const user = userEvent.setup();
      await user.click(input(field));
      await user.tab();
      await waitFor(() => expect(calls(method)).toHaveLength(1));
      await user.type(input(field), '/changed');
      await user.tab();
      await waitFor(() => expect(calls(method)).toHaveLength(2));
      if (oldValid) {
        expect(await screen.findByText(errorText)).toBeVisible();
        expect(input(field)).toHaveAttribute('aria-invalid', 'true');
      } else {
        await waitFor(() =>
          expect(input(field)).not.toHaveAttribute('aria-invalid', 'true')
        );
      }
      await act(async () => {
        await new Promise((done) => setTimeout(done, 20));
      });
      await act(async () => {
        old.resolve(response(oldValid));
        await new Promise((done) => setTimeout(done, 20));
      });
      if (oldValid) {
        expect(screen.getByText(errorText)).toBeVisible();
        expect(input(field)).toHaveAttribute('aria-invalid', 'true');
      } else {
        expect(input(field)).not.toHaveAttribute('aria-invalid', 'true');
      }
      expect(input(field)).toHaveValue(
        (field === 'url' ? rpc : api) + '/changed'
      );
      expect(calls('addCustomRpc')).toHaveLength(0);
      expect(calls('setActiveNetwork')).toHaveLength(0);
    }
  );

  it.each(['changed', 'cleared', 'restored'] as const)(
    'ignores a pending response after the value is %s without another blur',
    async (edit) => {
      const old = deferred<any>();
      const normal = mockEmitter.getMockImplementation()!;
      mockEmitter.mockImplementation((path, args) =>
        path[1] === method ? old.promise : normal(path, args)
      );
      mount(0);
      const user = userEvent.setup();
      const original = input(field).value;
      await user.click(input(field));
      await user.tab();
      await waitFor(() => expect(calls(method)).toHaveLength(1));
      await user.clear(input(field));
      if (edit === 'changed')
        await user.type(input(field), original + '/changed');
      if (edit === 'restored') await user.type(input(field), original);
      await act(async () => {
        old.resolve(response(false));
        await new Promise((done) => setTimeout(done, 20));
      });
      expect(screen.queryByText(errorText)).toBeNull();
      if (field === 'url' && edit === 'cleared') {
        expect(screen.getByText('settings.rpcUrlRequired')).toBeVisible();
        expect(input(field)).toHaveAttribute('aria-invalid', 'true');
      } else {
        expect(input(field)).not.toHaveAttribute('aria-invalid', 'true');
      }
      if (field === 'url') expect(input('chainId')).toHaveValue('0');
      expect(calls(method)).toHaveLength(1);
      expect(calls('addCustomRpc')).toHaveLength(0);
    }
  );

  it('ignores an older transport rejection after the current URL succeeds', async () => {
    const old = deferred<any>();
    const normal = mockEmitter.getMockImplementation()!;
    let requests = 0;
    mockEmitter.mockImplementation((path, args) => {
      if (path[1] !== method) return normal(path, args);
      return ++requests === 1 ? old.promise : Promise.resolve(response(true));
    });
    mount();
    const user = userEvent.setup();
    await user.click(input(field));
    await user.tab();
    await waitFor(() => expect(calls(method)).toHaveLength(1));
    await user.type(input(field), '/changed');
    await user.tab();
    await waitFor(() => expect(calls(method)).toHaveLength(2));
    await act(async () => {
      old.reject(new Error('Earlier endpoint transport failed'));
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(input(field)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText('Earlier endpoint transport failed')).toBeNull();
    expect(calls('addCustomRpc')).toHaveLength(0);
    expect(calls('setActiveNetwork')).toHaveLength(0);
  });
});

it('keeps an earlier blur from replacing the active submission validation', async () => {
  const old = deferred<any>();
  const submission = deferred<any>();
  const normal = mockEmitter.getMockImplementation()!;
  let requests = 0;
  mockEmitter.mockImplementation((path, args) => {
    if (path[1] !== 'getRpc') return normal(path, args);
    return ++requests === 1 ? old.promise : submission.promise;
  });
  mount();
  const user = userEvent.setup();
  await user.click(input('url'));
  await user.tab();
  await waitFor(() => expect(calls('getRpc')).toHaveLength(1));
  fireEvent.submit(document.querySelector('form')!);
  await waitFor(() => expect(calls('getRpc')).toHaveLength(2));
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
    old.resolve({ ...network, chainId: 1338 });
    await new Promise((done) => setTimeout(done, 20));
  });
  expect(screen.queryByText('settings.chainIdMismatch')).toBeNull();
  expect(input('url')).not.toHaveAttribute('aria-invalid', 'true');
  expect(input('url')).toBeDisabled();
  await act(async () => submission.resolve({ ...network, chainId: 1338 }));
  expect(await screen.findByText('settings.chainIdMismatch')).toBeVisible();
  expect(input('url')).toBeEnabled();
  expect(calls('addCustomRpc')).toHaveLength(0);
  expect(calls('setActiveNetwork')).toHaveLength(0);
});
