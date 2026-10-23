/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';

import { EvmNftsList } from './EvmNftsList';

const CONTRACT = '0x111111111111111111111111111111111111e115';
const SYMBOL = 'EDITIONS';
const TOKEN_IDS = [
  '0',
  '7',
  '8',
  '115792089237316195423570985008687907853269984665640564039457584007913129639935',
];
const MUTATION_SCOPE = { account: 'nft-owner', network: 'nft-network' };
const mockEmitter = jest.fn();
let mockState: any;

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string | number> = {}) => {
      const copy = jest.requireActual('assets/locales/en.json');
      const value = key
        .split('.')
        .reduce((parent, field) => parent?.[field], copy);
      return typeof value === 'string'
        ? value.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: 'nft-owner',
    network: 'nft-network',
  }),
}));
jest.mock('components/index', () => ({
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
  HiTrash: () => null,
  RiShareForward2Line: () => null,
  LoadingSvg: () => <span aria-hidden="true" />,
  MdBugReport: () => null,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));

const asset = (tokenId?: string) => ({
  id: `${CONTRACT}-5700${tokenId === undefined ? '' : `-${tokenId}`}`,
  contractAddress: CONTRACT,
  chainId: 5700,
  tokenSymbol: SYMBOL,
  name: 'Synthetic editions',
  balance: 2,
  decimals: 0,
  tokenStandard: tokenId === undefined ? 'ERC-721' : 'ERC-1155',
  isNft: true,
  ...(tokenId === undefined ? {} : { tokenId, rawBalance: '2' }),
});
const inventory = () => mockState.vault.accountAssets.HDAccount[0].ethereum;
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/home?tab=assets']}>
      <EvmNftsList
        scope="nft-removal-scope"
        state={{ isCoinSelected: false, searchValue: '', sortByValue: '' }}
      />
    </MemoryRouter>
  );
const removalLabel = (tokenId: string) =>
  en.nftDetails.removeNamedTokenId
    .replace('{{symbol}}', SYMBOL)
    .replace('{{tokenId}}', tokenId);
const rowFor = (tokenId: string) =>
  screen.getByRole('button', { name: removalLabel(tokenId) }).closest('li')!;
const setTokenInventory = (tokenId: string) => {
  mockState.vault.accountAssets.HDAccount[0].ethereum = [
    asset(tokenId),
    asset(tokenId === '8' ? '7' : '8'),
  ];
};
const removalButton = (row: HTMLElement) =>
  within(row).getByRole('button', { name: /^(?:Delete|Remove) / });
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
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { chainId: 5700 },
      accountAssets: {
        HDAccount: { 0: { ethereum: [asset('7'), asset('8')], syscoin: [] } },
      },
    },
  };
});

it.each(TOKEN_IDS)(
  'describes the selected ERC1155 token ID %s rather than claiming whole-collection removal',
  async (tokenId) => {
    setTokenInventory(tokenId);
    const user = userEvent.setup();
    mount();
    const before = JSON.stringify(inventory());
    await user.click(removalButton(rowFor(tokenId)));
    const dialog = screen.getByRole('dialog', {
      name: removalLabel(tokenId),
    });
    expect(dialog).toHaveTextContent(
      en.nftDetails.removeTokenIdConfirm
        .replace('{{name}}', SYMBOL)
        .replace('{{tokenId}}', tokenId)
    );
    expect(dialog).toHaveTextContent(
      `${en.settings.contractAddress}: ${CONTRACT}`
    );
    expect(dialog.querySelector('p')?.textContent).toBe(
      `${
        en.settings.contractAddress
      }: ${CONTRACT} ${en.nftDetails.removeTokenIdConfirm
        .replace('{{name}}', SYMBOL)
        .replace('{{tokenId}}', tokenId)}`
    );
    const text = dialog.textContent || '';
    const selectedToken = new RegExp(
      `(?:#|Token ID\\s*:?\\s*)${tokenId}\\b`,
      'i'
    );
    const observation = {
      identifiesSelectedTokenId: selectedToken.test(text),
      claimsWholeCollection: text.includes(
        'This will remove all NFTs in this collection.'
      ),
    };
    // Cancellation preserves both the selected ID and the other tracked ID.
    await user.click(
      within(dialog).getByRole('button', { name: en.buttons.cancel })
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(JSON.stringify(inventory())).toBe(before);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(observation).toEqual({
      identifiesSelectedTokenId: true,
      claimsWholeCollection: false,
    });
  }
);

it.each(TOKEN_IDS)(
  'keeps removal arguments scoped to the selected ERC1155 token ID %s',
  async (tokenId) => {
    setTokenInventory(tokenId);
    const user = userEvent.setup();
    mount();
    await user.click(removalButton(rowFor(tokenId)));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: en.buttons.delete,
      })
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'deleteTokenInfo'],
      [CONTRACT, 5700, tokenId, MUTATION_SCOPE]
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  }
);

it('retains the healthy ERC721 whole-collection confirmation and Cancel boundary', async () => {
  mockState.vault.accountAssets.HDAccount[0].ethereum = [asset()];
  const user = userEvent.setup();
  mount();
  const before = JSON.stringify(inventory());
  await user.click(removalButton(screen.getByRole('listitem')));
  const dialog = screen.getByRole('dialog', { name: en.send.deleteCollection });
  expect(dialog).toHaveTextContent(
    en.send.deleteCollectionConfirm.replace('{{name}}', SYMBOL)
  );
  expect(dialog).toHaveTextContent(
    `${en.settings.contractAddress}: ${CONTRACT}`
  );
  expect(dialog.querySelector('p')?.textContent).toBe(
    `${
      en.settings.contractAddress
    }: ${CONTRACT} ${en.send.deleteCollectionConfirm.replace(
      '{{name}}',
      SYMBOL
    )}`
  );
  await user.click(
    within(dialog).getByRole('button', { name: en.buttons.cancel })
  );
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(JSON.stringify(inventory())).toBe(before);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps healthy ERC721 removal whole-contract scoped with no token ID', async () => {
  mockState.vault.accountAssets.HDAccount[0].ethereum = [asset()];
  const user = userEvent.setup();
  mount();
  await user.click(removalButton(screen.getByRole('listitem')));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: en.buttons.delete,
    })
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'deleteTokenInfo'],
    [CONTRACT, 5700, undefined, MUTATION_SCOPE]
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('distinguishes same-symbol and same-token-ID ERC1155 contracts without widening removal', async () => {
  const otherContract = '0x222222222222222222222222222222222222e115';
  mockState.vault.accountAssets.HDAccount[0].ethereum = [
    asset('7'),
    {
      ...asset('7'),
      id: `${otherContract}-5700-7`,
      contractAddress: otherContract,
    },
  ];
  const user = userEvent.setup();
  mount();
  const before = JSON.stringify(inventory());
  for (const contract of [CONTRACT, otherContract]) {
    const hint = `${contract.slice(0, 4)}...${contract.slice(-4)} • #7`;
    const row = screen.getByText(hint).closest('li')!;
    await user.click(removalButton(row));
    const dialog = screen.getByRole('dialog', { name: removalLabel('7') });
    expect(dialog).toHaveTextContent(
      en.nftDetails.removeTokenIdConfirm
        .replace('{{name}}', SYMBOL)
        .replace('{{tokenId}}', '7')
    );
    expect(dialog).toHaveTextContent(
      `${en.settings.contractAddress}: ${contract}`
    );
    expect(dialog).not.toHaveTextContent(
      contract === CONTRACT ? otherContract : CONTRACT
    );
    await user.click(
      within(dialog).getByRole('button', { name: en.buttons.cancel })
    );
    expect(mockEmitter).not.toHaveBeenCalled();
    expect(JSON.stringify(inventory())).toBe(before);
  }
  const hint = `${otherContract.slice(0, 4)}...${otherContract.slice(-4)} • #7`;
  await user.click(removalButton(screen.getByText(hint).closest('li')!));
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: en.buttons.delete,
    })
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'deleteTokenInfo'],
    [otherContract, 5700, '7', MUTATION_SCOPE]
  );
});
