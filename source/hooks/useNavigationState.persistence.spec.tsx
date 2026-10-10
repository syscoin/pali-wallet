/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';

import { useConfirmSubmission } from 'pages/Send/useConfirmSubmission';
import {
  createBrowsingNavigationContext,
  getWalletNavigationScope,
} from 'utils/navigationState';

import { useNavigationState } from './useNavigationState';

let mockStored: any;
let mockVaultState: any;
let mockAuth: any;
let mockReadFailure = false;
let mockEntryCounter = 0;
const mockActionEmitter = jest.fn();
const mockRunError = jest.fn();
const mockWrite = jest.fn(async (_key, value) => {
  mockStored = JSON.parse(JSON.stringify(value));
});
const mockRemove = jest.fn(async () => {
  mockStored = undefined;
});
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockVaultState },
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: async () => {
      if (mockReadFailure) {
        mockReadFailure = false;
        throw new Error('Storage read unavailable');
      }
      return mockStored === undefined
        ? undefined
        : JSON.parse(JSON.stringify(mockStored));
    },
    setItem: (key: string, value: any) => mockWrite(key, value),
    removeItem: () => mockRemove(),
  },
}));
jest.mock('react-redux', () => ({ useSelector: (select: any) => select() }));
jest.mock('hooks/useController', () => ({ useController: () => mockAuth }));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockAuth,
}));

const Probe = () => {
  useNavigationState();
  const location = useLocation();
  return (
    <>
      <output data-testid="route">{location.pathname + location.search}</output>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      {location.pathname === '/send/confirm' && <SubmissionControls />}
    </>
  );
};
const SubmissionControls = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const submission = useConfirmSubmission({
    location,
    navigate,
    controllerEmitter: mockActionEmitter,
    ...mockAuth,
  });
  return (
    <button
      disabled={submission.blocked}
      onClick={() => {
        void submission
          .run(async () => {
            await submission.controllerEmitter(
              ['wallet', 'sendAndSaveEthTransaction'],
              []
            );
          })
          .catch(mockRunError);
      }}
    >
      Confirm send
    </button>
  );
};
const mount = () =>
  render(
    <HashRouter>
      <Probe />
    </HashRouter>
  );
const nativeEntry = (
  path: string,
  state?: any,
  key = `entry-${mockEntryCounter}`
) => {
  window.history.replaceState(
    { idx: 0, key, usr: state },
    '',
    `/app.html#${path}`
  );
};
const confirmation = () => ({
  external: false,
  submissionStarted: false,
  tx: { signed: 'prepared-payload', nonce: 19, password: 'secret-input' },
  walletScope: getWalletNavigationScope(),
  returnContext: {
    ...createBrowsingNavigationContext({
      pathname: '/send/eth',
      state: {
        formValues: {
          receiver: 'synthetic-recipient',
          amount: '0.000000000000000001',
        },
        selectedAsset: {
          symbol: 'TOKEN',
          contractAddress: 'synthetic-contract',
        },
      },
    }),
    scrollPositions: { 'wallet-layout': 128 },
    returnContext: {
      ...createBrowsingNavigationContext({
        pathname: '/settings/account/smart-account-policy',
      }),
      scrollPositions: { 'smart-account-policy': 432 },
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockEntryCounter += 1;
  mockReadFailure = false;
  mockActionEmitter.mockResolvedValue({ hash: 'synthetic-transaction-hash' });
  mockStored = undefined;
  document.body.innerHTML = '';
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: undefined,
  });
  mockAuth = {
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  };
  mockVaultState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      accounts: {
        HDAccount: {
          0: { address: 'synthetic-address', xpub: 'synthetic-xpub' },
        },
      },
      activeNetwork: {
        kind: 'Ethereum',
        chainId: 1,
        slip44: 60,
        url: 'https://rpc.test',
        apiUrl: 'https://api.test',
      },
    },
    vaultGlobal: { advancedSettings: { autolock: 30 } },
  };
  window.history.replaceState(null, '', '/app.html');
});

it('idle confirmation closes and reopens into the unsigned caller with its Settings parent', async () => {
  nativeEntry('/send/confirm', confirmation());
  const first = mount();
  await waitFor(() => expect(mockStored?.currentPath).toBe('/send/eth'));
  fireEvent(window, new Event('pagehide'));
  await act(async () => undefined);
  first.unmount();
  window.history.replaceState(null, '', '/app.html');
  mount();
  await waitFor(() =>
    expect(screen.getByTestId('route').textContent).toBe('/send/eth')
  );
  const state = JSON.parse(screen.getByTestId('state').textContent!);
  expect(state.formValues).toEqual({
    receiver: 'synthetic-recipient',
    amount: '0.000000000000000001',
  });
  expect(state.scrollPositions).toEqual({ 'wallet-layout': 128 });
  expect(state.returnContext.returnRoute).toBe(
    '/settings/account/smart-account-policy'
  );
  expect(state.returnContext.scrollPositions).toEqual({
    'smart-account-policy': 432,
  });
  expect(JSON.stringify(mockStored)).not.toMatch(
    /prepared-payload|secret-input|"tx"|"nonce"/
  );
});

it.each([true, 'unknown'])(
  'native submission marker %p precedes React and prevents draft revival',
  async (marker) => {
    const idle = confirmation();
    nativeEntry('/send/confirm', idle);
    mount();
    await waitFor(() => expect(mockStored?.currentPath).toBe('/send/eth'));
    nativeEntry(
      '/send/confirm',
      { ...idle, submissionStarted: marker },
      'submission-entry'
    );
    fireEvent(window, new Event('pagehide'));
    await waitFor(() =>
      expect(mockStored?.currentPath).toBe(
        '/settings/account/smart-account-policy'
      )
    );
    expect(
      JSON.parse(screen.getByTestId('state').textContent!).submissionStarted
    ).toBe(false);
    expect(JSON.stringify(mockStored)).not.toMatch(
      /formValues|synthetic-recipient|prepared-payload/
    );
  }
);

it.each(['pathname', 'query', 'key'])(
  'native %s departure suppresses stale ordinary-page writes',
  async (change) => {
    nativeEntry('/home?tab=assets', { searchValue: 'old-filter' });
    mount();
    await waitFor(() =>
      expect(mockStored?.currentPath).toBe('/home?tab=assets')
    );
    const newer = { ...mockStored, currentPath: '/receive', state: {} };
    mockStored = newer;
    mockWrite.mockClear();
    if (change === 'pathname') nativeEntry('/receive', {}, 'next');
    if (change === 'query') nativeEntry('/home?tab=activity', {}, 'next');
    if (change === 'key') nativeEntry('/home?tab=assets', {}, 'next');
    fireEvent(window, new Event('pagehide'));
    await act(async () => undefined);
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockStored).toEqual(newer);
  }
);

it('a synchronous wallet scope change blocks stale saves before React rerenders', async () => {
  nativeEntry('/home', { searchValue: 'old-account-filter' });
  mount();
  await waitFor(() => expect(mockStored?.currentPath).toBe('/home'));
  mockWrite.mockClear();
  mockVaultState.vault.activeAccount.id = 2;
  fireEvent(window, new Event('pagehide'));
  await act(async () => undefined);
  expect(mockWrite).not.toHaveBeenCalled();
});

const useSharedLocks = () => {
  let tail = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: any, work: () => Promise<any>) => {
        const next = tail.then(work);
        tail = next.then(
          () => undefined,
          () => undefined
        );
        return next;
      },
    },
  });
};

it('a real Confirm click and navigation marker share storage cleanup without spuriously canceling submission', async () => {
  useSharedLocks();
  nativeEntry('/send/confirm', confirmation());
  mount();
  await waitFor(() => expect(mockStored?.currentPath).toBe('/send/eth'));
  fireEvent.click(screen.getByText('Confirm send'));
  await act(async () => undefined);
  expect(mockRunError).not.toHaveBeenCalled();
  await waitFor(() => expect(mockActionEmitter).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(mockStored?.currentPath).toBe(
      '/settings/account/smart-account-policy'
    )
  );
  expect(mockRunError).not.toHaveBeenCalled();
  expect(JSON.stringify(mockStored)).not.toMatch(
    /formValues|synthetic-recipient|prepared-payload/
  );
  fireEvent(window, new Event('pagehide'));
  await act(async () => undefined);
  expect(mockStored.currentPath).toBe('/settings/account/smart-account-policy');
});

it('a pre-broadcast storage failure makes no action RPC and the same live Confirm entry can retry', async () => {
  useSharedLocks();
  nativeEntry('/send/confirm', confirmation());
  mount();
  await waitFor(() => expect(mockStored?.currentPath).toBe('/send/eth'));
  mockReadFailure = true;
  fireEvent.click(screen.getByText('Confirm send'));
  await waitFor(() => expect(mockRunError).toHaveBeenCalledTimes(1));
  expect(mockActionEmitter).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      (screen.getByText('Confirm send') as HTMLButtonElement).disabled
    ).toBe(false)
  );
  await waitFor(() => expect(mockStored?.currentPath).toBe('/send/eth'));
  fireEvent.click(screen.getByText('Confirm send'));
  await waitFor(() => expect(mockActionEmitter).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(mockStored?.currentPath).toBe(
      '/settings/account/smart-account-policy'
    )
  );
});
