/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';

import { EvmAssetsList } from './EvmList';

const FIRST = '0x111111111111111111111111111111111111e020';
const SECOND = '0x222222222222222222222222222222222222e021';
const UNIQUE = '0x333333333333333333333333333333333333e022';
const SCOPE = 'asset-identity-scope';
const MUTATION_SCOPE = { account: 'public-account', network: 'public-network' };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockNavigateWithContext = jest.fn();
const mockCreateContext = jest.fn((location: any, state: any) => ({
  location,
  state,
}));
let mockState: any;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const copy = jest.requireActual('assets/locales/en.json');
      const value = key
        .split('.')
        .reduce((parent, field) => parent?.[field], copy);
      return typeof value === 'string'
        ? value.replace(/\{\{(\w+)\}\}/g, (_match, name) => values[name] ?? '')
        : key;
    },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  createBrowsingNavigationContext: (...args: any[]) =>
    mockCreateContext(args[0], args[1]),
  navigateWithContext: (...args: any[]) => mockNavigateWithContext(...args),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'public-account',
    network: 'public-network',
  }),
}));
jest.mock('components/index', () => ({
  // Keep the real shim: assertions below must reach the native button, not a
  // test double that forwards props the production IconButton would drop.
  IconButton: jest.requireActual('components/IconButton').IconButton,
  TokenIcon: () => <span aria-hidden="true" />,
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

const token = (contract: string, symbol: string, overrides: any = {}) => ({
  id: `${contract}-5700`,
  contractAddress: contract,
  chainId: 5700,
  tokenSymbol: symbol,
  name: symbol,
  balance: 0,
  decimals: 18,
  tokenStandard: 'ERC-20',
  isNft: false,
  ...overrides,
});
const assets = () => mockState.vault.accountAssets.HDAccount[0].ethereum;
const hint = (contract: string) =>
  `${contract.slice(0, 6)}...${contract.slice(-4)}`;
const rowFor = (contract: string) => {
  const row = screen
    .getAllByRole('listitem')
    .find((element) => element.getAttribute('title') === contract);
  expect(row).toBeDefined();
  return row!;
};
const actionFor = (contract: string, kind: 'view' | 'delete') => {
  const symbol = assets().find(
    (asset: any) => asset.contractAddress === contract
  ).tokenSymbol;
  return within(rowFor(contract)).getByRole('button', {
    name: (kind === 'view'
      ? en.tokens.viewTokenDetails
      : en.tokens.deleteToken
    ).replace('{{symbol}}', symbol),
  });
};
const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <EvmAssetsList scope={SCOPE} />
    </MemoryRouter>
  );

const originalResizeObserver = globalThis.ResizeObserver;
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
  globalThis.ResizeObserver = originalResizeObserver;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset().mockResolvedValue(undefined);
  mockState = {
    vault: {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: { chainId: 5700, kind: 'ethereum' },
      accountAssets: {
        HDAccount: {
          0: {
            ethereum: [
              token(FIRST, 'MATCH20'),
              token(SECOND, 'MATCH20'),
              token(UNIQUE, 'UNIQUE20'),
            ],
            syscoin: [],
          },
        },
      },
    },
    vaultGlobal: { networkStatus: 'idle' },
  };
});

it.each(['MATCH20', 'match20'])(
  'shows distinct contract hints for same-symbol tokens, including case variation %s',
  (secondSymbol) => {
    assets()[1].tokenSymbol = secondSymbol;
    renderList();
    expect(within(rowFor(FIRST)).getByText(hint(FIRST))).toBeVisible();
    expect(within(rowFor(SECOND)).getByText(hint(SECOND))).toBeVisible();
    expect(within(rowFor(UNIQUE)).queryByText(hint(UNIQUE))).toBeNull();
    expect(rowFor(FIRST)).not.toHaveTextContent(hint(SECOND));
  }
);

it('does not grow unique rows for a matching symbol on another chain or an NFT', () => {
  mockState.vault.accountAssets.HDAccount[0].ethereum = [
    token(FIRST, 'SOLO'),
    token(SECOND, 'SOLO', { chainId: 1 }),
    token(UNIQUE, 'SOLO', { isNft: true, tokenStandard: 'ERC-721' }),
  ];
  renderList();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(rowFor(FIRST)).not.toHaveTextContent(hint(FIRST));
  expect(actionFor(FIRST, 'view')).toHaveAccessibleName(
    'View details for SOLO token'
  );
  expect(actionFor(FIRST, 'delete')).toHaveAccessibleName('Delete SOLO token');
});

it('retains duplicate identity when contract search leaves only one matching row', async () => {
  const user = userEvent.setup();
  renderList();
  await user.click(
    screen.getByRole('button', { name: en.tooltip.searchAssets })
  );
  await user.type(
    screen.getByRole('textbox', {
      name: en.assetsHeader.tokenOrContractAddress,
    }),
    SECOND
  );
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(within(rowFor(SECOND)).getByText(hint(SECOND))).toBeVisible();
  expect(rowFor(SECOND)).not.toHaveTextContent(hint(FIRST));
});

it('exposes each exact contract on the real native Details and Delete buttons', () => {
  renderList();
  for (const contract of [FIRST, SECOND, UNIQUE]) {
    expect(rowFor(contract)).toHaveAttribute('title', contract);
    for (const kind of ['view', 'delete'] as const) {
      const button = actionFor(contract, kind);
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      // The installed dom-accessibility-api predates aria-description. Check
      // its actual native DOM forwarding here; the browser suite checks AX.
      expect(button).toHaveAttribute('aria-description', contract);
      expect(button).toBeEnabled();
    }
  }
});

it.each([FIRST, SECOND])(
  'shows the selected contract %s in confirmation and Cancel preserves both tokens',
  async (contract) => {
    const user = userEvent.setup();
    renderList();
    const before = JSON.stringify(assets());
    await user.click(actionFor(contract, 'delete'));
    const dialog = screen.getByRole('dialog', { name: 'Delete MATCH20 token' });
    expect(dialog).toHaveTextContent(
      en.tokens.confirmDeleteTokenEvm.replace('{{symbol}}', 'MATCH20')
    );
    expect(dialog).toHaveTextContent(
      `${en.settings.contractAddress}: ${contract}`
    );
    expect(dialog).not.toHaveTextContent(contract === FIRST ? SECOND : FIRST);
    await user.click(
      within(dialog).getByRole('button', { name: en.buttons.cancel })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(JSON.stringify(assets())).toBe(before);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  }
);

it.each([FIRST, SECOND])(
  'keeps confirmation bound to exact selected contract %s and existing mutation scope',
  async (contract) => {
    const user = userEvent.setup();
    renderList();
    await user.click(actionFor(contract, 'delete'));
    const dialog = screen.getByRole('dialog', { name: 'Delete MATCH20 token' });
    await user.click(
      within(dialog).getByRole('button', { name: en.buttons.delete })
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'deleteTokenInfo'],
      [contract, 5700, undefined, MUTATION_SCOPE]
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  }
);

it('keeps each duplicate Details action bound to its original asset ID', async () => {
  const user = userEvent.setup();
  renderList();
  for (const contract of [FIRST, SECOND]) {
    await user.click(actionFor(contract, 'view'));
    expect(mockNavigateWithContext).toHaveBeenLastCalledWith(
      mockNavigate,
      '/home/details',
      { id: `${contract}-5700`, hash: null },
      expect.objectContaining({
        state: expect.objectContaining({ tab: 'assets' }),
      })
    );
  }
  expect(mockEmitter).not.toHaveBeenCalled();
});
