/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { INetworkType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import ExternalAddRPC from './ExternalAddRPC';

const mockEmitter = jest.fn();
const mockAlert = { success: jest.fn(), error: jest.fn() };
let mockNetworks: { ethereum: Record<number, any> };
let mockSavedNetworks: Record<number, any>;
let mockDeferRegistry = false;
const host = 'https://synthetic-network-request.invalid';
const network = {
  chainId: 1337,
  kind: INetworkType.Ethereum,
  label: 'Synthetic requested network',
  url: 'https://synthetic-rpc.invalid',
  currency: 'syn',
  explorer: 'https://synthetic-explorer.invalid/',
  apiUrl: 'https://synthetic-explorer-api.invalid',
  slip44: 60,
};
const query = {
  host,
  eventName: 'wallet_addEthereumChain',
  chainConfig: {
    chainId: '0x539',
    chainName: network.label,
    rpcUrls: [network.url],
    nativeCurrency: { name: 'Synthetic', symbol: 'SYN', decimals: 18 },
    blockExplorerUrls: [network.explorer],
    apiUrl: network.apiUrl,
  },
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
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => ({ vaultGlobal: { networks: mockNetworks } }),
  },
}));
jest.mock('utils/index', () => ({
  extractErrorMessage: (error: Error, fallback: string) =>
    error.message || fallback,
}));

const mount = () =>
  render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: '/external/add-EthChain',
          search: `?data=${encodeURIComponent(JSON.stringify(query))}`,
        },
      ]}
    >
      <ExternalAddRPC />
    </MemoryRouter>
  );
const methodCalls = (method: string) =>
  mockEmitter.mock.calls.filter(([[, name]]) => name === method);
const add = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.addNetwork' }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};
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
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockNetworks = { ethereum: {} };
  mockSavedNetworks = {};
  mockDeferRegistry = false;
  mockEmitter
    .mockReset()
    .mockImplementation(async ([, method], [params] = []) => {
      if (method === 'getRpc')
        return {
          ...network,
          url: params.url,
          label: params.label,
          currency: params.symbol.toLowerCase(),
          explorer: params.explorer,
          apiUrl: params.apiUrl,
        };
      if (method === 'getState')
        return { vaultGlobal: { networks: { ethereum: mockSavedNetworks } } };
      if (method === 'addCustomRpc') {
        // Match MainController: once saved, adding the chain again rejects.
        if (mockSavedNetworks[params.chainId])
          throw new Error('network already exists, remove or edit it');
        mockSavedNetworks[params.chainId] = { ...params, default: false };
        if (!mockDeferRegistry) {
          mockNetworks.ethereum[params.chainId] =
            mockSavedNetworks[params.chainId];
        }
        return params;
      }
      if (method === 'testExplorerApi') return { success: true };
      return undefined;
    });
});
afterEach(() => jest.restoreAllMocks());

it('retries switching after a successful add without trying to add the saved network twice', async () => {
  const normal = mockEmitter.getMockImplementation()!;
  let switchAttempts = 0;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'setActiveNetwork' && ++switchAttempts === 1)
      throw new Error('Network switch persistence failed');
    return normal(path, args);
  });
  mount();
  add();
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith(
      'Network switch persistence failed',
      expect.any(Object)
    )
  );
  expect(methodCalls('addCustomRpc')).toHaveLength(1);
  expect(methodCalls('getRpc')).toHaveLength(1);
  expect(methodCalls('testExplorerApi')).toHaveLength(1);
  expect(methodCalls('setActiveNetwork')).toHaveLength(1);
  expect(methodCalls('getState')).toHaveLength(0);
  expect(
    screen.getByRole('button', { name: 'buttons.addNetwork' })
  ).toBeEnabled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
  add();
  await waitFor(() => expect(methodCalls('setActiveNetwork')).toHaveLength(2));
  expect(methodCalls('addCustomRpc')).toHaveLength(1);
  expect(methodCalls('getRpc')).toHaveLength(2);
  expect(methodCalls('testExplorerApi')).toHaveLength(2);
  expect(methodCalls('getState')).toEqual([[['wallet', 'getState'], []]]);
  expect(methodCalls('setActiveNetwork')[1]).toEqual([
    ['wallet', 'setActiveNetwork'],
    [network, false],
  ]);
  expect(mockAlert.success).toHaveBeenCalledWith(
    'settings.rpcSuccessfullyAdded'
  );
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
    timeout: 3000,
  });
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    `wallet_addEthereumChain.${host}`,
    null
  );
});

it.each(['getRpc', 'testExplorerApi', 'addCustomRpc'])(
  'allows a clean retry when %s fails before an add succeeds',
  async (failedMethod) => {
    const normal = mockEmitter.getMockImplementation()!;
    let failed = false;
    mockEmitter.mockImplementation(async (path, args) => {
      if (path[1] === failedMethod && !failed) {
        failed = true;
        throw new Error('Temporary setup failure');
      }
      return normal(path, args);
    });
    const view = mount();
    add();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'buttons.addNetwork' })
      ).toBeEnabled()
    );
    await waitFor(() => expect(failed).toBe(true));
    expect(methodCalls('setActiveNetwork')).toHaveLength(0);
    add();
    await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
    expect(methodCalls('setActiveNetwork')).toHaveLength(1);
    expect(Object.values(mockNetworks.ethereum)).toHaveLength(1);
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
    view.unmount();
  }
);

it('keeps a healthy overlapping form submission to one validation, add, switch and reply', async () => {
  const response = deferred<any>();
  const normal = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) =>
    path[1] === 'getRpc' ? response.promise : normal(path, args)
  );
  mount();
  const form = document.querySelector('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(methodCalls('getRpc')).toHaveLength(1));
  expect(
    screen.getByRole('button', { name: 'buttons.addNetwork' })
  ).toBeDisabled();
  await act(async () => response.resolve(network));
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
  expect(methodCalls('getRpc')).toHaveLength(1);
  expect(methodCalls('getState')).toHaveLength(0);
  expect(methodCalls('addCustomRpc')).toHaveLength(1);
  expect(methodCalls('setActiveNetwork')).toEqual([
    [
      ['wallet', 'setActiveNetwork'],
      [network, false],
    ],
  ]);
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
    timeout: 3000,
  });
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('does not reuse an added network when the validated proposal changes', async () => {
  const normal = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'setActiveNetwork')
      throw new Error('Temporary switch failure');
    return normal(path, args);
  });
  mount();
  add();
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText('settings.networkName'), {
    target: { value: 'Changed network proposal' },
  });
  add();
  await waitFor(() => expect(methodCalls('addCustomRpc')).toHaveLength(2));
  expect(methodCalls('addCustomRpc')[1][1][0].label).toBe(
    'Changed network proposal'
  );
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenLastCalledWith(
      'network already exists, remove or edit it',
      expect.any(Object)
    )
  );
  expect(methodCalls('setActiveNetwork')).toHaveLength(1);
  expect(mockNetworks.ethereum[network.chainId].label).toBe(network.label);
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
});

it.each([false, true])(
  'adds the unchanged proposal again if its saved registration was removed before retry (popup delayed=%s)',
  async (delayed) => {
    mockDeferRegistry = delayed;
    const normal = mockEmitter.getMockImplementation()!;
    let attempts = 0;
    mockEmitter.mockImplementation(async (path, args) => {
      if (path[1] === 'setActiveNetwork' && ++attempts === 1)
        throw new Error('Temporary switch failure');
      return normal(path, args);
    });
    mount();
    add();
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
    delete mockSavedNetworks[network.chainId];
    add();
    await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
    expect(methodCalls('addCustomRpc')).toHaveLength(2);
    expect(methodCalls('setActiveNetwork')).toHaveLength(2);
    expect(mockSavedNetworks[network.chainId]).toMatchObject(network);
    expect(methodCalls('getState')).toHaveLength(1);
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
  }
);

it('trusts a successful add ACK while the popup registration broadcast is still delayed', async () => {
  mockDeferRegistry = true;
  const normal = mockEmitter.getMockImplementation()!;
  let attempts = 0;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'setActiveNetwork' && ++attempts === 1)
      throw new Error('Network switch persistence failed');
    return normal(path, args);
  });
  mount();
  add();
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
  expect(mockSavedNetworks[network.chainId]).toMatchObject(network);
  expect(mockNetworks.ethereum[network.chainId]).toBeUndefined();
  add();
  await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
  expect(methodCalls('addCustomRpc')).toHaveLength(1);
  expect(methodCalls('setActiveNetwork')).toHaveLength(2);
  expect(methodCalls('getState')).toHaveLength(1);
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
    timeout: 3000,
  });
  expect(dispatchBackgroundEvent).toHaveBeenCalledTimes(1);
});

it('refuses to switch a saved registration that was edited before its popup broadcast arrived', async () => {
  mockDeferRegistry = true;
  const normal = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation(async (path, args) => {
    if (path[1] === 'setActiveNetwork')
      throw new Error('Network switch persistence failed');
    return normal(path, args);
  });
  mount();
  add();
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
  mockSavedNetworks[network.chainId] = {
    ...network,
    url: 'https://edited-rpc.invalid',
  };
  expect(mockNetworks.ethereum[network.chainId]).toBeUndefined();
  add();
  await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(2));
  expect(methodCalls('getState')).toHaveLength(1);
  expect(methodCalls('addCustomRpc')).toHaveLength(2);
  expect(methodCalls('setActiveNetwork')).toHaveLength(1);
  expect(mockSavedNetworks[network.chainId].url).toBe(
    'https://edited-rpc.invalid'
  );
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
});

it.each(['rejected', 'malformed'])(
  'leaves an uncertain saved network untouched after a %s state read and allows a later retry',
  async (failure) => {
    const normal = mockEmitter.getMockImplementation()!;
    let attempts = 0;
    let failedRead = false;
    mockEmitter.mockImplementation(async (path, args) => {
      if (path[1] === 'setActiveNetwork' && ++attempts === 1)
        throw new Error('Network switch persistence failed');
      if (path[1] === 'getState' && !failedRead) {
        failedRead = true;
        if (failure === 'rejected') throw new Error('Wallet state unavailable');
        return {};
      }
      return normal(path, args);
    });
    mount();
    add();
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(1));
    add();
    await waitFor(() => expect(mockAlert.error).toHaveBeenCalledTimes(2));
    expect(methodCalls('addCustomRpc')).toHaveLength(1);
    expect(methodCalls('setActiveNetwork')).toHaveLength(1);
    expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
    expect(window.close).not.toHaveBeenCalled();
    add();
    await waitFor(() => expect(mockAlert.success).toHaveBeenCalledTimes(1));
    expect(methodCalls('getState')).toHaveLength(2);
    expect(methodCalls('addCustomRpc')).toHaveLength(1);
    expect(methodCalls('setActiveNetwork')).toHaveLength(2);
    await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });
  }
);
