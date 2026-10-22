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

const urlInput = (field: 'url' | 'explorer' | 'apiUrl') =>
  document.querySelector<HTMLInputElement>('#rpc_' + field)!;
const addButton = () =>
  screen.getByRole('button', { name: 'buttons.addNetwork' });

describe.each(['url', 'explorer', 'apiUrl'] as const)(
  '%s URL format rule',
  (field) => {
    it.each(['not-a-url', 'ftp://unsupported.invalid/path'])(
      'rejects %s before adding or switching',
      async (value) => {
        mount();
        const user = userEvent.setup();
        const input = urlInput(field);
        await user.clear(input);
        await user.type(input, value);
        await user.click(addButton());
        expect(
          await screen.findByText('settings.validUrlRequired')
        ).toBeVisible();
        expect(input).toHaveValue(value);
        expect(addButton()).toBeEnabled();
        expect(calls('addCustomRpc')).toHaveLength(0);
        expect(calls('setActiveNetwork')).toHaveLength(0);
        expect(mockAlert.success).not.toHaveBeenCalled();
        expect(window.close).not.toHaveBeenCalled();
      }
    );
  }
);

it.each(['', '   ', '\u00a0\u00a0'])(
  'accepts blank optional URL fields %j without an API probe',
  async (value) => {
    mount();
    const user = userEvent.setup();
    for (const field of ['explorer', 'apiUrl'] as const) {
      await user.clear(urlInput(field));
      if (value) await user.type(urlInput(field), value);
    }
    await user.click(addButton());
    await waitFor(() => expect(calls('addCustomRpc')).toHaveLength(1));
    expect(calls('getRpc')).toEqual([
      [
        ['wallet', 'getRpc'],
        [expect.objectContaining({ url: rpcA, explorer: rpcA, apiUrl: value })],
      ],
    ]);
    expect(calls('testExplorerApi')).toHaveLength(0);
    expect(calls('setActiveNetwork')).toHaveLength(1);
    expect(urlInput('explorer')).toHaveValue(value);
    expect(urlInput('apiUrl')).toHaveValue(value);
    expect(screen.queryByText('settings.validUrlRequired')).toBeNull();
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
  }
);

it('keeps the RPC URL required while optional URL fields can be empty', async () => {
  mount();
  const user = userEvent.setup();
  await user.clear(urlInput('url'));
  await user.click(addButton());
  expect(await screen.findByText('settings.rpcUrlRequired')).toBeVisible();
  expect(urlInput('url')).toHaveValue('');
  expect(calls('addCustomRpc')).toHaveLength(0);
  expect(calls('setActiveNetwork')).toHaveLength(0);
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
});

it('accepts padded valid URLs and preserves the existing submission callbacks', async () => {
  mount();
  const user = userEvent.setup();
  const values = {
    url: '  https://changed-rpc.invalid/path  ',
    explorer: '  https://changed-explorer.invalid/path  ',
    apiUrl: '  https://changed-api.invalid/path  ',
  };
  for (const field of ['url', 'explorer', 'apiUrl'] as const) {
    await user.clear(urlInput(field));
    await user.type(urlInput(field), values[field]);
  }
  await user.click(addButton());
  await waitFor(() => expect(calls('addCustomRpc')).toHaveLength(1));
  const rpcCalls = calls('getRpc');
  expect(rpcCalls[rpcCalls.length - 1]).toEqual([
    ['wallet', 'getRpc'],
    [
      expect.objectContaining({
        url: values.url.trim(),
        explorer: values.explorer.trim(),
        apiUrl: values.apiUrl,
      }),
    ],
  ]);
  const apiCalls = calls('testExplorerApi');
  expect(apiCalls.length).toBeGreaterThan(0);
  expect(apiCalls.every((call) => call[1][0] === values.apiUrl.trim())).toBe(
    true
  );
  expect(calls('setActiveNetwork')).toHaveLength(1);
  for (const field of ['url', 'explorer', 'apiUrl'] as const)
    expect(urlInput(field)).toHaveValue(values[field]);
  expect(screen.queryByText('settings.validUrlRequired')).toBeNull();
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
    timeout: 3000,
  });
});

it('keeps RPC and API blur probes without adding or switching a network', async () => {
  mount();
  const user = userEvent.setup();
  const rpc = '  https://blur-rpc.invalid/path  ';
  const api = '  https://blur-api.invalid/path  ';
  await user.clear(urlInput('url'));
  await user.type(urlInput('url'), rpc);
  await user.tab();
  await waitFor(() => expect(calls('getRpc')).toHaveLength(1));
  expect(calls('getRpc')[0]).toEqual([
    ['wallet', 'getRpc'],
    [expect.objectContaining({ url: rpc.trim() })],
  ]);
  await user.clear(urlInput('apiUrl'));
  await user.type(urlInput('apiUrl'), api);
  await user.tab();
  await waitFor(() => expect(calls('testExplorerApi')).toHaveLength(1));
  expect(calls('testExplorerApi')[0]).toEqual([
    ['wallet', 'testExplorerApi'],
    [api.trim()],
  ]);
  expect(urlInput('url')).toHaveValue(rpc);
  expect(urlInput('apiUrl')).toHaveValue(api);
  expect(calls('addCustomRpc')).toHaveLength(0);
  expect(calls('setActiveNetwork')).toHaveLength(0);
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
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
