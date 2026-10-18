/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import ExternalAddRPC from './ExternalAddRPC';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
const rpcA = 'https://first-rpc.invalid';
const apiA = 'https://first-api.invalid';
const network = {
  chainId: 1337,
  kind: 'ethereum',
  label: 'Validation test network',
  url: rpcA,
  currency: 'test',
  explorer: 'https://explorer.invalid',
  apiUrl: apiA,
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
const mount = () =>
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
                chainId: '0x539',
                chainName: network.label,
                rpcUrls: [rpcA],
                nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 },
                blockExplorerUrls: [network.explorer],
                apiUrl: apiA,
              },
            })
          )}`,
        },
      ]}
    >
      <ExternalAddRPC />
    </MemoryRouter>
  );
const calls = (method: string) =>
  mockEmitter.mock.calls.filter(([[, name]]) => name === method);
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

it('freezes the reviewed fields during submission and preserves their submitted values', async () => {
  const pending = deferred<any>();
  const normal = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) =>
    path[1] === 'getRpc' ? pending.promise : normal(path, args)
  );
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'buttons.addNetwork' }));
  await waitFor(() => expect(calls('getRpc')).toHaveLength(1));
  const input = document.querySelector('#rpc_url')!;
  await user.type(input, '/changed');
  await act(async () => pending.resolve(network));
  await waitFor(() => expect(calls('addCustomRpc')).toHaveLength(1));
  expect(calls('addCustomRpc')[0][1][0].url).toBe(rpcA);
  expect(input).toHaveValue(calls('addCustomRpc')[0][1][0].url);
  expect(input).toBeDisabled();
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
    timeout: 3000,
  });
});

it('unlocks fields after a rejected submission and saves the corrected retry', async () => {
  let rejected = false;
  const normal = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path, args) => {
    if (path[1] === 'getRpc' && !rejected) {
      rejected = true;
      return Promise.reject(new Error('Current endpoint failed'));
    }
    return normal(path, args);
  });
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'buttons.addNetwork' }));
  expect(
    await screen.findByText('Current endpoint failed')
  ).toBeInTheDocument();
  const input = document.querySelector('#rpc_url')!;
  expect(input).toBeEnabled();
  await user.type(input, '/changed');
  await user.click(screen.getByRole('button', { name: 'buttons.addNetwork' }));
  await waitFor(() => expect(calls('addCustomRpc')).toHaveLength(1));
  expect(calls('addCustomRpc')[0][1][0].url).toBe(rpcA + '/changed');
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
    timeout: 3000,
  });
});
