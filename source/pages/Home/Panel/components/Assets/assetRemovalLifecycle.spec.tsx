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
  SyscoinAssetsList: () => null,
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
}));
jest.mock('utils/tokens', () => ({ getTokenTypeBadgeColor: () => '' }));

const ADDRESS = `0x${'11'.repeat(20)}`;
const CONTRACT = `0x${'22'.repeat(20)}`;
const nft = (symbol: string, contract = CONTRACT) => ({
  id: `${contract}-5700`,
  chainId: 5700,
  contractAddress: contract,
  tokenSymbol: symbol,
  name: symbol,
  balance: 1,
  decimals: 0,
  tokenStandard: 'ERC-721',
  isNft: true,
});
const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <AssetsPanel />
    </MemoryRouter>
  );
const openConfirmation = () => {
  fireEvent.click(screen.getByRole('button', { name: 'tooltip.viewNFTs' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete COLLECTION collection' })
  );
  const dialog = screen.getByRole('dialog', { name: 'send.deleteCollection' });
  return dialog;
};
const openDelete = () => {
  const dialog = openConfirmation();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
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
          0: { ethereum: [nft('COLLECTION')], syscoin: [] },
          1: { ethereum: [nft('COLLECTION')], syscoin: [] },
        },
      },
    },
    vaultGlobal: { networkStatus: 'idle' },
  };
});
afterEach(() => jest.restoreAllMocks());

it('reports a current removal rejection instead of silently closing and leaving the collection unchanged', async () => {
  mockEmitter.mockRejectedValueOnce(new Error('Token removal unavailable'));
  renderList();
  openDelete();
  await act(async () => undefined);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'deleteTokenInfo'],
    [CONTRACT, 5700, undefined]
  );
  expect(mockAlert.error).toHaveBeenCalledWith('Token removal unavailable');
  expect(
    screen.getByRole('button', { name: 'Delete COLLECTION collection' })
  ).toBeTruthy();
  expect(mockAlert.success).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete COLLECTION collection' })
  );
  fireEvent.click(
    within(
      screen.getByRole('dialog', { name: 'send.deleteCollection' })
    ).getByRole('button', { name: 'Delete' })
  );
  await act(async () => undefined);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  expect(mockAlert.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('closes a healthy removal and follows the current asset list without claiming a rollback', async () => {
  let finish!: () => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  const view = renderList();
  openDelete();
  expect(
    screen.getByRole('dialog', { name: 'send.deleteCollection' })
  ).toBeTruthy();
  await act(async () => {
    mockState = {
      ...mockState,
      vault: {
        ...mockState.vault,
        accountAssets: {
          HDAccount: {
            ...mockState.vault.accountAssets.HDAccount,
            0: { ethereum: [], syscoin: [] },
          },
        },
      },
    };
    view.rerender(
      <MemoryRouter initialEntries={['/home?tab=assets']}>
        <AssetsPanel />
      </MemoryRouter>
    );
    finish();
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('home.youHaveNoTokens')).toBeTruthy();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('claims a pending removal synchronously and keeps duplicate Delete and dismissal unavailable', async () => {
  let finish!: () => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<void>((resolve) => (finish = resolve))
  );
  renderList();
  const dialog = openConfirmation();
  const confirm = within(dialog).getByRole('button', { name: 'Delete' });
  await act(async () => {
    fireEvent.click(confirm);
    fireEvent.click(confirm);
  });
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  expect(
    (
      within(dialog).getByRole('button', {
        name: 'buttons.cancel',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true);
  await act(async () => finish());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it('reports a delayed persistence rejection after the last asset has removed its child list without rolling it back', async () => {
  let fail!: (error: Error) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<void>((_resolve, reject) => (fail = reject))
  );
  const view = renderList();
  openDelete();
  // MainController removes local metadata before awaiting saveWalletState.
  // Its real AssetsPanel caller consequently unmounts the final NFT list.
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      accountAssets: {
        HDAccount: {
          ...mockState.vault.accountAssets.HDAccount,
          0: { ethereum: [], syscoin: [] },
        },
      },
    },
  };
  view.rerender(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <AssetsPanel />
    </MemoryRouter>
  );
  expect(screen.getByText('home.youHaveNoTokens')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'tooltip.viewNFTs' })).toBeNull();
  await act(async () =>
    fail(new Error('Token metadata persistence unavailable'))
  );
  expect(mockAlert.error).toHaveBeenCalledWith(
    'Token metadata persistence unavailable'
  );
  expect(mockState.vault.accountAssets.HDAccount[0].ethereum).toEqual([]);
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockAlert.success).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('lets the real parent retire the old NFT view before a late account-scoped removal error', async () => {
  let fail!: (error: Error) => void;
  mockEmitter.mockImplementationOnce(
    () => new Promise<void>((_resolve, reject) => (fail = reject))
  );
  const view = renderList();
  openDelete();
  mockState = {
    ...mockState,
    vault: {
      ...mockState.vault,
      activeAccount: { id: 1, type: 'HDAccount' },
    },
  };
  view.rerender(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <AssetsPanel />
    </MemoryRouter>
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'tooltip.viewNFTs' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete COLLECTION collection' })
  );
  await act(async () => fail(new Error('Old account removal unavailable')));
  expect(
    screen.getByRole('dialog', { name: 'send.deleteCollection' })
  ).toBeTruthy();
  expect(mockAlert.error).not.toHaveBeenCalled();
});

it.each(['chain', 'rpc', 'unmount', 'account-roundtrip'])(
  'retires removal feedback permanently after an actual %s departure',
  async (departure) => {
    let fail!: (error: Error) => void;
    mockEmitter.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (fail = reject))
    );
    const view = renderList();
    openDelete();
    const rerender = () =>
      view.rerender(
        <MemoryRouter initialEntries={['/home?tab=assets']}>
          <AssetsPanel />
        </MemoryRouter>
      );
    if (departure === 'unmount') view.unmount();
    else if (departure === 'account-roundtrip') {
      for (const id of [1, 0]) {
        mockState = {
          ...mockState,
          vault: {
            ...mockState.vault,
            activeAccount: { id, type: 'HDAccount' },
          },
        };
        rerender();
      }
    } else {
      mockState = {
        ...mockState,
        vault: {
          ...mockState.vault,
          activeNetwork: {
            ...mockState.vault.activeNetwork,
            ...(departure === 'chain'
              ? { chainId: 5701 }
              : { url: 'https://replacement-rpc.invalid' }),
          },
        },
      };
      rerender();
    }
    await act(async () => fail(new Error('Retired removal failure')));
    expect(mockAlert.error).not.toHaveBeenCalled();
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  }
);
