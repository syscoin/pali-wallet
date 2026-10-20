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

import { verifyERC721OwnershipHelper } from 'scripts/Background/controllers/assets/nft-utils';

import { SendEth } from './SendEth';

const OWNER = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const OTHER_OWNER = '0x4444444444444444444444444444444444444444';
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockOwnerOf = jest.fn();
const mockStatus = {
  isUnlocked: true,
  isLoading: false,
  connectionUnavailable: false,
};
let mockState: any;
let mockDiscovered: any[];
const mockAsset = {
  id: `${CONTRACT}-1`,
  contractAddress: CONTRACT,
  chainId: 1,
  tokenSymbol: 'COLLECTION',
  tokenStandard: 'ERC-721',
  isNft: true,
  decimals: 0,
  balance: 2,
};
const mockLocation = {
  key: 'nft-send',
  pathname: '/send/eth',
  state: undefined,
};
const originalResizeObserver = globalThis.ResizeObserver;
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => mockStatus,
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ ...mockStatus, controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    alert: { error: jest.fn(), info: jest.fn() },
  }),
}));
jest.mock('hooks/useAdjustedExplorer', () => ({
  useAdjustedExplorer: () => 'https://explorer.invalid',
}));
jest.mock('utils/ethersV6Compat', () => ({
  ...jest.requireActual('utils/ethersV6Compat'),
  Contract: jest.fn(() => ({ ownerOf: mockOwnerOf })),
}));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('utils/index', () => ({
  getWalletNavigationScope: (...args: any[]) =>
    jest
      .requireActual('utils/navigationState')
      .getWalletNavigationScope(...args),
  getAssetBalance: (...args: any[]) =>
    jest.requireActual('utils/transactions').getAssetBalance(...args),
  ellipsis: (value: string) => value,
  adjustUrl: (value: string) => value,
  formatFullPrecisionBalance: (value: any) => String(value),
  createNavigationContext: jest.fn(),
  navigateWithContext: (...args: any[]) => mockNavigate(...args),
  getTokenTypeBadgeColor: () => '',
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccountWithAssets: (state: any) => ({
    account: state.vault.accounts.HDAccount[0],
    assets: { ethereum: [mockAsset], syscoin: [] },
  }),
  selectValidEnsCache: () => ({}),
  selectEnsNameToAddress: () => ({}),
}));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Tooltip: ({ children }: any) => <>{children}</>,
  Icon: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('@headlessui/react', () => {
  const Pass = ({ children }: any) => (
    <>{typeof children === 'function' ? children({ open: true }) : children}</>
  );
  return {
    Menu: Object.assign(Pass, { Button: Pass, Items: Pass, Item: Pass }),
  };
});

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // JSDOM has no layout observations.
    }
    unobserve() {
      // JSDOM has no layout observations.
    }
    disconnect() {
      // JSDOM has no layout observations.
    }
  } as any;
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener() {
      // Static media query for the component fixture.
    },
    removeListener() {
      // Static media query for the component fixture.
    },
    addEventListener() {
      // Static media query for the component fixture.
    },
    removeEventListener() {
      // Static media query for the component fixture.
    },
    dispatchEvent: () => false,
  })) as any;
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockDiscovered = [];
  window.history.replaceState(null, '', '/app.html');
  mockState = {
    vault: {
      accounts: {
        HDAccount: {
          0: {
            id: 0,
            address: OWNER,
            xpub: 'public-account',
            balances: { ethereum: '10', syscoin: '10' },
          },
        },
      },
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        kind: 'ethereum',
        chainId: 1,
        url: 'https://rpc.invalid',
        currency: 'eth',
        label: 'Ethereum',
        explorer: 'https://explorer.invalid',
      },
      isBitcoinBased: false,
      accountTransactions: {},
    },
    vaultGlobal: { activeSlip44: 60, isBitcoinBased: false },
  };
  mockOwnerOf.mockImplementation(async (id: string) => {
    if (id === '7') return OWNER;
    if (id === '8') return OTHER_OWNER;
    throw new Error('ERC721: invalid token ID');
  });
  mockEmitter.mockImplementation((path: string[], args?: any[]) => {
    const method = path.at(-1);
    if (method === 'fetchNftTokenIds') return Promise.resolve(mockDiscovered);
    if (method === 'verifyERC721Ownership')
      return verifyERC721OwnershipHelper(
        args![0],
        args![1],
        args![2],
        {} as any
      );
    if (method === 'getFeeDataWithDynamicMaxPriorityFeePerGas')
      return Promise.resolve({
        maxFeePerGas: '1000000000',
        maxPriorityFeePerGas: '100000000',
      });
    return Promise.resolve(undefined);
  });
});
afterEach(() => {
  jest.useRealTimers();
});

const prepare = async () => {
  render(<SendEth />);
  fireEvent.click(screen.getByRole('button', { name: /COLLECTI.*ERC-721/ }));
  await act(async () => {
    await Promise.resolve();
  });
  fireEvent.change(screen.getByPlaceholderText('send.receiver'), {
    target: { value: RECIPIENT },
  });
};
const enterId = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText('send.enterTokenId'), {
    target: { value },
  });
const verify = async (id: string) => {
  enterId(id);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'verifyERC721Ownership'],
    [CONTRACT, OWNER, [id]]
  );
};
const next = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  });
};

it('admits a manually entered NFT only after the real ownership helper confirms this owner', async () => {
  await prepare();
  await verify('7');
  expect(screen.getByText(/send.youOwnThisToken/)).toBeInTheDocument();
  await next();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][2].tx.token.tokenId).toBe('7');
});

it('preserves an owned ID discovered for the selected collection', async () => {
  mockDiscovered = [{ tokenId: '7', balance: 1, verified: true }];
  await prepare();
  await next();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
  expect(mockNavigate.mock.calls[0][2].tx.token.tokenId).toBe('7');
});

it('admits an explicitly selected ID from multiple discovered owned NFTs', async () => {
  mockDiscovered = [
    { tokenId: '7', balance: 1, verified: true },
    { tokenId: '10', balance: 1, verified: true },
  ];
  await prepare();
  fireEvent.click(screen.getByRole('button', { name: '#10' }));
  await next();
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate.mock.calls[0][2].tx.token.tokenId).toBe('10');
});

it('does not admit a manual ID after ownerOf proves it belongs to another account', async () => {
  await prepare();
  await verify('8');
  expect(screen.getByText(/send.youDontOwnThisToken/)).toBeInTheDocument();
  await next();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('does not admit a manual ID while ownership verification is pending', async () => {
  let finish!: (owner: string) => void;
  const owner = new Promise<string>((resolve) => {
    finish = resolve;
  });
  mockOwnerOf.mockImplementation((id: string) =>
    id === '7' ? owner : Promise.reject(new Error('ERC721: invalid token ID'))
  );
  await prepare();
  await verify('7');
  expect(screen.getByText('send.verifyingOwnership')).toBeInTheDocument();
  try {
    await next();
    expect(mockNavigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      finish(OWNER);
    });
  }
  await next();
  expect(mockNavigate).toHaveBeenCalledTimes(1);
});

it.each(['RPC failure', 'refused verification'])(
  'does not admit a manual ID after %s',
  async (scenario) => {
    if (scenario === 'refused verification') {
      // A contract returning an owner for the independent invalid-ID probe is
      // refused by the real ownership helper, rather than marked verified.
      mockOwnerOf.mockResolvedValue(OWNER);
    }
    await prepare();
    await verify('9');
    expect(screen.getByText(/send.youDontOwnThisToken/)).toBeInTheDocument();
    await next();
    expect(mockNavigate).not.toHaveBeenCalled();
  }
);

it('invalidates a positive manual result immediately when the token ID changes', async () => {
  await prepare();
  await verify('7');
  await act(async () => {
    enterId('8');
    fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  });
  expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(500);
  });
  expect(screen.getByText(/send.youDontOwnThisToken/)).toBeInTheDocument();
  await next();
  expect(mockNavigate).not.toHaveBeenCalled();
  await verify('7');
  await next();
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  expect(mockNavigate.mock.calls[0][2].tx.token.tokenId).toBe('7');
});

it('does not reuse a late positive result for a different manual token ID', async () => {
  let finish!: (owner: string) => void;
  const old = new Promise<string>((resolve) => {
    finish = resolve;
  });
  mockOwnerOf.mockImplementation((id: string) => {
    if (id === '7') return old;
    if (id === '8') return Promise.resolve(OTHER_OWNER);
    throw new Error('ERC721: invalid token ID');
  });
  await prepare();
  await verify('7');
  await verify('8');
  await act(async () => {
    finish(OWNER);
  });
  await next();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByText(/send.youDontOwnThisToken/)).toBeInTheDocument();
});
