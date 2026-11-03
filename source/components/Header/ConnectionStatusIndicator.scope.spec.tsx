/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import path from 'path';
import React, { useLayoutEffect } from 'react';
import { Provider, useSelector } from 'react-redux';
import * as ts from 'typescript';

import { ConnectionStatusIndicator } from 'components/Header/ConnectionStatusIndicator';
import MainController from 'scripts/Background/controllers/MainController';
import { CancellablePromises } from 'scripts/Background/controllers/promises/cancellablesPromises';
import dapp from 'state/dapp';
import vault from 'state/vault';
import vaultGlobal, * as globalActions from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

let mockStore: any;
const mockNavigate = jest.fn();
const mockReadBalance = jest.fn();
const originalFetch = globalThis.fetch;
const mockT = (key: string) => key;
let observations: Array<{ loading: boolean; message: string | null }> = [];
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockStore.getState(),
    dispatch: (action: any) => mockStore.dispatch(action),
  },
  persistCommittedWalletState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockT }) }));
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children, content }: any) => (
    <div data-testid="indicator-tooltip" data-content={content || ''}>
      {children}
    </div>
  ),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));
jest.mock('scripts/Background', () => ({
  getController: () => ({
    dapp: { handleStateChange: jest.fn().mockResolvedValue(undefined) },
  }),
  notificationManager: { cleanup: jest.fn(), notifyNetworkChange: jest.fn() },
}));
jest.mock('@sidhujag/sysweb3-network', () => ({
  ...jest.requireActual('@sidhujag/sysweb3-network'),
  retryableFetch: () => {
    throw new Error('Public HTTP forbidden in feedback probe');
  },
}));
const type = KeyringAccountType.HDAccount;
const network = {
  chainId: 5700,
  kind: 'ethereum',
  url: 'https://synthetic.invalid',
  slip44: 60,
  currency: 'SYS',
  label: 'Synthetic EVM',
};
let controller: any;
let releaseNetwork: (value: { success: boolean }) => void;
const pending = () => {
  let resolve!: (balance: string) => void, reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tooltip = () => screen.getByTestId('indicator-tooltip');
const dot = () => tooltip().querySelector('button > span')!;
const advance = async (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
const begin = () => {
  let result!: Promise<boolean>;
  // Same public method invoked by MasterController.refresh; only balance I/O
  // is deferred. The real method controls loading, quality and status reducers.
  act(() => {
    result = controller.getLatestUpdateForCurrentAccount();
  });
  return result;
};
const ObserveActivity = () => {
  const targetChain = useSelector(
    (state: any) => state.vaultGlobal.networkTarget?.chainId
  );
  const loading = useSelector(
    (state: any) => state.vaultGlobal.loadingStates.isLoadingBalances
  );
  useLayoutEffect(() => {
    observations.push({
      loading,
      message: tooltip().getAttribute('data-content'),
    });
  }, [loading, targetChain]);
  return <ConnectionStatusIndicator />;
};
beforeEach(() => {
  jest.useFakeTimers({ now: 1000000 });
  jest.clearAllMocks();
  observations = [];
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(console, 'warn').mockImplementation();
  jest.spyOn(console, 'log').mockImplementation();
  globalThis.fetch = jest
    .fn()
    .mockRejectedValue(new Error('Public HTTP forbidden'));
  const initial = vault(undefined, { type: 'test/init' }),
    global = vaultGlobal(undefined, { type: 'test/init' });
  mockStore = configureStore({
    reducer: { vault, vaultGlobal, dapp },
    preloadedState: {
      vault: {
        ...initial,
        activeNetwork: network,
        isBitcoinBased: false,
        activeAccount: { id: 0, type },
        accounts: {
          ...initial.accounts,
          [type]: {
            0: {
              id: 0,
              address: '0x' + '11'.repeat(20),
              balances: { ethereum: '2', syscoin: -1 },
            },
          },
        },
        accountAssets: { [type]: { 0: { ethereum: [], syscoin: [] } } },
        accountTransactions: {
          [type]: { 0: { ethereum: { 5700: [] }, syscoin: {} } },
        },
      } as any,
      vaultGlobal: { ...global, activeSlip44: 60 },
    },
    middleware: (getDefault) => getDefault({ serializableCheck: false }),
  });
  controller = Object.create(MainController.prototype);
  Object.assign(controller, {
    nativeBalanceRevision: 0,
    balanceLoadingRequestId: 0,
    networkRequestGeneration: 0,
    walletSessionGeneration: 0,
    targetedBalanceVersions: new Map(),
    targetedBalanceEvictions: 0,
    cancellablePromises: new CancellablePromises(),
    balancesManager: {
      utils: { getBalanceUpdatedForAccount: mockReadBalance },
    },
    updateAssetsFromCurrentAccount: jest.fn().mockResolvedValue(undefined),
    updateUserTransactionsState: jest.fn().mockResolvedValue(undefined),
    getActiveKeyring: () => ({
      isUnlocked: () => true,
      ethereumTransaction: { web3Provider: {} },
    }),
  });
  // Object.create does not initialize class-property arrows. Evaluate these
  // exact production AST initializers, preserving their bodies and lexical this.
  const source = readFileSync(
    path.resolve(
      __dirname,
      '../../scripts/Background/controllers/MainController.ts'
    ),
    'utf8'
  );
  const parsed = ts.createSourceFile(
    'MainController.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const cls = parsed.statements.find(ts.isClassDeclaration)!;
  for (const name of ['setActiveNetworkLogic', 'handleNetworkChangeError']) {
    const member = cls.members.find(
      (m) => ts.isPropertyDeclaration(m) && m.name?.getText(parsed) === name
    ) as ts.PropertyDeclaration;
    expect(member?.initializer && ts.isArrowFunction(member.initializer)).toBe(
      true
    );
    const output = ts.transpileModule(
      'const actual = ' + member.initializer!.getText(parsed) + ';',
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } }
    ).outputText;
    controller[name] = new Function(
      'store',
      'startSwitchNetwork',
      'resetNetworkQualityForNewNetwork',
      'clearNetworkQualityIfStale',
      'INetworkType',
      'NETWORK_CHANGE_CANCELLED_ERROR',
      'setStoreError',
      'switchNetworkError',
      output + '\nreturn actual;'
    ).call(
      controller,
      {
        getState: () => mockStore.getState(),
        dispatch: (action: any) => mockStore.dispatch(action),
      },
      globalActions.startSwitchNetwork,
      globalActions.resetNetworkQualityForNewNetwork,
      globalActions.clearNetworkQualityIfStale,
      INetworkType,
      'Network change cancelled',
      globalActions.setError,
      globalActions.switchNetworkError
    );
  }
  const configuration = new Promise<{ success: boolean }>((resolve) => {
    releaseNetwork = resolve;
  });
  Object.assign(controller, {
    activeRapidPolls: new Map(),
    receiptBalanceRefresh: { cancel: jest.fn() },
    walletStateGeneration: 0,
    assetUpdateRequestId: 0,
    setSignerNetwork: jest.fn(() => configuration),
    setFiat: jest.fn().mockResolvedValue(undefined),
    saveWalletState: jest.fn().mockResolvedValue(undefined),
  });
  render(
    <Provider store={mockStore}>
      <ObserveActivity />
    </Provider>
  );
});
afterEach(() => {
  cleanup();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

const target = {
  ...network,
  chainId: 5701,
  url: 'https://new-target.synthetic.invalid',
  label: 'New target',
};
const switchTarget = () => {
  let result!: Promise<unknown>;
  act(() => {
    result = controller.setActiveNetwork(target);
  });
  return result;
};
const finishTarget = async (
  result: Promise<unknown>,
  old?: ReturnType<typeof pending>
) => {
  mockReadBalance.mockResolvedValue('2');
  await act(async () => {
    releaseNetwork({ success: true });
    await result;
    if (old) old.resolve('999');
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  });
};
it.each([4800, 8800])(
  'new target does not inherit warning age from an old balance read after %sms',
  async (elapsed) => {
    const old = pending();
    mockReadBalance.mockReturnValueOnce(old.promise);
    const previous = begin();
    await advance(elapsed);
    const switched = switchTarget();
    try {
      await act(async () => {
        await previous;
      });
      expect(controller.setSignerNetwork).toHaveBeenCalledWith(
        expect.objectContaining(target),
        expect.any(Function)
      );
      expect(mockStore.getState().vaultGlobal.networkStatus).toBe('switching');
      expect(mockStore.getState().vaultGlobal.networkTarget.chainId).toBe(5701);
      expect(mockStore.getState().vaultGlobal.networkQuality).toBeUndefined();
      expect(
        mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
      ).toBe(false);
      await advance(250);
      expect({
        targetAge: 250,
        className: dot().className,
        message: tooltip().getAttribute('data-content'),
      }).toEqual({
        targetAge: 250,
        className: expect.stringContaining('bg-brand-blue500'),
        message: 'networkConnection.switchingNetwork',
      });
    } finally {
      await finishTarget(switched, old);
    }
  }
);
it('a fresh admitted target owns its ordinary five-second warning threshold', async () => {
  const switched = switchTarget();
  try {
    await advance(4999);
    expect(dot()).toHaveClass('bg-brand-blue500');
    expect(tooltip()).toHaveAttribute(
      'data-content',
      'networkConnection.switchingNetwork'
    );
    await advance(1);
    expect(dot()).toHaveClass('bg-orange-500');
  } finally {
    await finishTarget(switched);
  }
});
it.each(['success', 'error'])(
  'current target recovery ignores a late old balance %s',
  async (outcome) => {
    const old = pending();
    mockReadBalance.mockReturnValueOnce(old.promise);
    const previous = begin();
    await advance(200);
    const switched = switchTarget();
    await act(async () => {
      await previous;
    });
    await finishTarget(switched);
    await act(async () => {
      if (outcome === 'success') old.resolve('999');
      else old.reject(new Error('Old network unavailable'));
      for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    });
    expect(mockStore.getState().vault.activeNetwork.chainId).toBe(5701);
    expect(mockStore.getState().vaultGlobal.networkStatus).toBe('idle');
    expect(mockStore.getState().vault.accounts[type][0].balances.ethereum).toBe(
      '2'
    );
    expect(tooltip()).toHaveAttribute(
      'data-content',
      'networkConnection.operationCompleted'
    );
    expect(dot()).toHaveClass('bg-green-500');
  }
);

it('retires an already-visible old warning on the first new-target render', async () => {
  const old = pending();
  mockReadBalance.mockReturnValueOnce(old.promise);
  const previous = begin();
  await advance(6000);
  expect(dot()).toHaveClass('bg-orange-500');
  const switched = switchTarget();
  try {
    expect(observations.at(-1)?.message).toBe(
      'networkConnection.switchingNetwork'
    );
    expect(dot()).toHaveClass('bg-brand-blue500');
    await act(async () => {
      await previous;
    });
    expect(dot()).toHaveClass('bg-brand-blue500');
  } finally {
    await finishTarget(switched, old);
  }
});
it('keeps one target warning and critical deadlines despite unrelated Redux updates and late A completion', async () => {
  const old = pending();
  mockReadBalance.mockReturnValueOnce(old.promise);
  const previous = begin();
  await advance(4800);
  const switched = switchTarget();
  try {
    await act(async () => {
      await previous;
    });
    await advance(1000);
    await act(async () => {
      old.resolve('999');
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    act(() => {
      mockStore.dispatch(globalActions.setLastLogin());
      mockStore.dispatch(globalActions.setIsPollingUpdate(true));
    });
    await advance(3999);
    expect(dot()).toHaveClass('bg-brand-blue500');
    act(() => {
      mockStore.dispatch(globalActions.setLastLogin());
    });
    await advance(1);
    expect(dot()).toHaveClass('bg-orange-500');
    await advance(3999);
    expect(dot()).toHaveClass('bg-orange-500');
    act(() => {
      mockStore.dispatch(globalActions.setIsPollingUpdate(false));
    });
    await advance(1);
    expect(dot()).toHaveClass('bg-red-600');
    expect(tooltip()).toHaveAttribute(
      'data-content',
      'networkConnection.operationFailing'
    );
  } finally {
    await finishTarget(switched, old);
  }
});

it('keeps the same target deadline when configuration progresses into its balance read', async () => {
  const balance = pending();
  mockReadBalance.mockReturnValueOnce(balance.promise);
  const switched = switchTarget();
  try {
    await advance(4000);
    await act(async () => {
      releaseNetwork({ success: true });
      await switched;
      for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
    });
    expect(mockStore.getState().vault.activeNetwork.chainId).toBe(5701);
    expect(mockStore.getState().vaultGlobal.networkTarget).toBeUndefined();
    expect(
      mockStore.getState().vaultGlobal.loadingStates.isLoadingBalances
    ).toBe(true);
    await advance(999);
    expect(dot()).toHaveClass('bg-brand-blue500');
    await advance(1);
    expect(dot()).toHaveClass('bg-orange-500');
    await advance(4000);
    expect(dot()).toHaveClass('bg-red-600');
  } finally {
    await act(async () => {
      balance.resolve('2');
      for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
    });
  }
});
