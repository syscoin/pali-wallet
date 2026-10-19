/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import { AssetsPanel } from '../../AssetsPanel';

let mockState: any;
const mockEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('./index', () => ({
  EvmAssetsList: jest.requireActual('./EvmList').EvmAssetsList,
  SyscoinAssetsList: jest.requireActual('./SyscoinList').SyscoinAssetsList,
}));
jest.mock('components/index', () => ({
  IconButton: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  TokenIcon: () => null,
}));
jest.mock('components/Modal', () => ({
  ConfirmationModal: jest.requireActual('components/Modal/Modal')
    .ConfirmationModal,
}));
jest.mock('components/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  BsCheck2: () => null,
  CgSearch: () => null,
  CgImport: () => null,
  FaRegStickyNote: () => null,
  HiTrash: () => null,
  LoadingSvg: () => <span aria-hidden="true" />,
  MdBugReport: () => null,
  MdClose: () => null,
  RiArrowLeftSLine: () => null,
  RiCoinLine: () => null,
  RiOrderPlayLine: () => null,
  RiShareForward2Line: () => null,
}));
jest.mock('utils/index', () => ({
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
  truncate: (value: string) => value,
  ellipsis: (value: string) => value,
  formatFullPrecisionBalance: (value: number) => String(value),
  formatCurrency: (value: string) => value,
  getTokenLogo: () => '',
}));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));

const ADDRESS = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const token = (symbol: string, contract = CONTRACT) => ({
  id: `${contract}-5700`,
  chainId: 5700,
  contractAddress: contract,
  tokenSymbol: symbol,
  name: symbol,
  balance: 1,
  decimals: 0,
  tokenStandard: 'ERC-20',
  isNft: false,
});
const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <AssetsPanel />
    </MemoryRouter>
  );
const openConfirmation = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Delete TOKEN token' }));
  return screen.getByRole('dialog');
};
const openDelete = () => {
  const dialog = openConfirmation();
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'buttons.delete' })
  );
};
const rerender = (view: ReturnType<typeof render>) =>
  view.rerender(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <AssetsPanel />
    </MemoryRouter>
  );
const removeLocalAsset = () => {
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      accountAssets: {
        ...mockState.vault.accountAssets,
        HDAccount: {
          ...mockState.vault.accountAssets.HDAccount,
          0: { ethereum: [], syscoin: [] },
        },
      },
    },
  };
};
const pendingResult = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  // Observe the fixture promise independently so the baseline fire-and-forget
  // rejection does not terminate Jest before its missing UI feedback is checked.
  // This does not add a rejection handler to the component's implementation.
  void promise.catch(() => undefined);
  mockEmitter.mockReturnValueOnce(promise);
  return { promise, resolve, reject };
};
const originalObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalObserver;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset().mockResolvedValue(undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockState = {
    vault: {
      isBitcoinBased: false,
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 5700,
        url: 'https://synthetic-rpc.invalid',
      },
      accounts: {
        HDAccount: {
          0: { id: 0, address: ADDRESS },
          1: { id: 1, address: ADDRESS },
        },
      },
      accountAssets: {
        HDAccount: {
          0: { ethereum: [token('TOKEN')], syscoin: [] },
          1: { ethereum: [token('TOKEN')], syscoin: [] },
        },
      },
      accountTransactions: {
        HDAccount: {
          0: { ethereum: {}, syscoin: {} },
          1: { ethereum: {}, syscoin: {} },
        },
      },
    },
    vaultGlobal: { networkStatus: 'idle' },
  };
});
afterEach(() => jest.restoreAllMocks());

for (const kind of ['ERC20', 'SPT'] as const) {
  describe(kind + ' token removal lifecycle through AssetsPanel', () => {
    beforeEach(() => {
      if (kind === 'SPT') {
        mockState.vault.isBitcoinBased = true;
        mockState.vault.activeNetwork.kind = 'syscoin';
        for (const account of Object.values(
          mockState.vault.accountAssets.HDAccount
        ) as any[]) {
          account.ethereum = [];
          account.syscoin = [
            {
              assetGuid: '12345',
              chainId: 5700,
              symbol: 'TOKEN',
              name: 'TOKEN',
              balance: 1,
              decimals: 0,
            },
          ];
        }
      }
    });

    it('reports a current rejected removal and permits an explicit retry while the row remains', async () => {
      const pending = pendingResult();
      renderList();
      openDelete();
      await act(async () =>
        pending.reject(new Error('Token removal persistence unavailable'))
      );
      expect(mockEmitter.mock.results[0].value).toBe(pending.promise);
      expect(mockAlert.error).toHaveBeenCalledWith(
        'Token removal persistence unavailable'
      );
      expect(
        screen.getByRole('button', { name: 'Delete TOKEN token' })
      ).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      openDelete();
      await act(async () => undefined);
      expect(mockEmitter).toHaveBeenCalledTimes(2);
      expect(mockAlert.success).not.toHaveBeenCalled();
    });

    it('keeps the admitted removal pending and refuses re-entry until its real promise settles', async () => {
      const pending = pendingResult();
      renderList();
      openDelete();
      try {
        const current = screen.queryByRole('dialog');
        if (current)
          fireEvent.click(
            within(current).getByRole('button', { name: 'buttons.delete' })
          );
        else openDelete();
        expect(mockEmitter).toHaveBeenCalledTimes(1);
        const dialog = screen.getByRole('dialog');
        expect(
          (
            within(dialog).getByRole('button', {
              name: 'buttons.delete',
            }) as HTMLButtonElement
          ).disabled
        ).toBe(true);
        expect(
          (
            within(dialog).getByRole('button', {
              name: 'buttons.cancel',
            }) as HTMLButtonElement
          ).disabled
        ).toBe(true);
      } finally {
        await act(async () => pending.resolve());
      }
    });

    it('still reports current persistence failure after local removal unmounts the last child row', async () => {
      const pending = pendingResult();
      const view = renderList();
      openDelete();
      removeLocalAsset();
      rerender(view);
      expect(screen.getByText('home.youHaveNoTokens')).toBeTruthy();
      await act(async () =>
        pending.reject(new Error('Token metadata save failed'))
      );
      expect(mockAlert.error).toHaveBeenCalledWith(
        'Token metadata save failed'
      );
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockState.vault.accountAssets.HDAccount[0]).toEqual({
        ethereum: [],
        syscoin: [],
      });
      expect(mockAlert.success).not.toHaveBeenCalled();
    });

    it('completes a healthy current removal without inventing a failure or rollback', async () => {
      const pending = pendingResult();
      const view = renderList();
      openDelete();
      removeLocalAsset();
      rerender(view);
      await act(async () => pending.resolve());
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'deleteTokenInfo'],
        kind === 'SPT'
          ? ['12345', 5700, undefined, expect.any(Object)]
          : [CONTRACT, 5700, undefined, expect.any(Object)]
      );
      expect(screen.getByText('home.youHaveNoTokens')).toBeTruthy();
      expect(mockAlert.error).not.toHaveBeenCalled();
      expect(mockEmitter).toHaveBeenCalledTimes(1);
    });

    it('does not surface a retired failure after leaving the actual parent route', async () => {
      const pending = pendingResult();
      const view = renderList();
      openDelete();
      view.unmount();
      await act(async () =>
        pending.reject(new Error('Retired removal failure'))
      );
      expect(mockAlert.error).not.toHaveBeenCalled();
      expect(mockEmitter).toHaveBeenCalledTimes(1);
    });
  });
}
