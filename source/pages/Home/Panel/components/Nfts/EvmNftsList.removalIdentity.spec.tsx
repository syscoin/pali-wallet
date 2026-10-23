/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';
import { EvmNftsList } from 'pages/Home/Panel/components/Nfts/EvmNftsList';
import EthAccountController from 'scripts/Background/controllers/account/evm';
import EvmAssetsController from 'scripts/Background/controllers/assets/evm';
import vault, { createAccount, setNetworkChange } from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import {
  initialActiveHdAccountState,
  INetworkType,
  KeyringAccountType,
} from 'types/network';
import { Interface } from 'utils/ethersV6Compat';
import { ellipsis } from 'utils/format';

let mockStore: any;
const mockEmitter = jest.fn();
const OWNER = `0x${'aa'.repeat(20)}`;
const CONTRACTS = [
  '0x111111111111111111111111111111111111e721',
  '0x222222222222222222222222222222222222e722',
];
const MUTATION_SCOPE = { account: OWNER, network: '31337:synthetic' };
let symbols: string[];
let reads: Array<{ address: string; method: string }>;
let unexpectedFetches: string[];
const originalFetch = globalThis.fetch;
const originalObserver = globalThis.ResizeObserver;

jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({ navigate: jest.fn() }) }));
jest.mock('utils/navigationState', () => ({
  getWalletNavigationScope: () => ({
    account: OWNER,
    network: '31337:synthetic',
  }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, string> = {}) => {
      const value = key
        .split('.')
        .reduce((item: any, part) => item?.[part], en);
      return typeof value === 'string'
        ? value.replace(/{{(\w+)}}/g, (_match, name) => values[name] ?? '')
        : key;
    },
    i18n: { language: 'en' },
  }),
}));
jest.mock('components/index', () => ({
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
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
  LoadingSvg: () => null,
  MdBugReport: () => null,
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  createBrowsingNavigationContext: jest.fn(),
  navigateWithContext: jest.fn(),
}));

const ABI = new Interface([
  'function supportsInterface(bytes4) view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
]);
const runner = {
  getCode: async (address: string) => {
    expect(CONTRACTS).toContain(address.toLowerCase());
    return '0x6000';
  },
  call: async (transaction: { data: string; to: string }) => {
    const address = transaction.to.toLowerCase();
    const index = CONTRACTS.indexOf(address);
    expect(index).toBeGreaterThanOrEqual(0);
    const decoded = ABI.parseTransaction(transaction)!;
    reads.push({ address, method: decoded.name });
    if (decoded.name === 'supportsInterface')
      return ABI.encodeFunctionResult(decoded.name, [
        decoded.args[0] === '0x80ac58cd',
      ]);
    if (decoded.name === 'name' || decoded.name === 'symbol')
      return ABI.encodeFunctionResult(decoded.name, [symbols[index]]);
    expect(decoded.name).toBe('balanceOf');
    expect(decoded.args[0].toLowerCase()).toBe(OWNER);
    return ABI.encodeFunctionResult('balanceOf', [1]);
  },
};
const holdings = () =>
  mockStore.getState().vault.accountAssets.HDAccount[0].ethereum;
const mount = () =>
  render(
    <Provider store={mockStore}>
      <MemoryRouter initialEntries={['/home?tab=assets']}>
        <ul>
          <EvmNftsList
            scope="31337:synthetic"
            state={{ isCoinSelected: false, searchValue: '', sortByValue: '' }}
          />
        </ul>
      </MemoryRouter>
    </Provider>
  );
const rowFor = (contract: string) =>
  screen.getByText(ellipsis(contract, 4, 4)).closest('li')!;
const deleteButton = (contract: string) =>
  within(rowFor(contract)).getByRole('button', {
    name: `Delete ${symbols[CONTRACTS.indexOf(contract)]} collection`,
  });
const dialogSnapshot = () => {
  const dialog = screen.getByRole('dialog');
  const labelId = dialog.getAttribute('aria-labelledby')!;
  return {
    name: document.getElementById(labelId)?.textContent,
    text: dialog.textContent?.replace(/\s+/g, ' ').trim(),
    fullContractsPresent: CONTRACTS.filter((contract) =>
      dialog.textContent?.includes(contract)
    ),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  reads = [];
  unexpectedFetches = [];
  globalThis.fetch = jest.fn(async (input) => {
    unexpectedFetches.push(String(input));
    throw new Error('No public HTTP allowed');
  });
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
  mockStore = configureStore({ reducer: { vault, vaultGlobal } });
  mockStore.dispatch(setActiveSlip44(60));
  mockStore.dispatch(
    setNetworkChange({
      activeNetwork: {
        kind: INetworkType.Ethereum,
        chainId: 31337,
        slip44: 60,
        label: 'Synthetic EVM',
        currency: 'ETH',
        url: 'https://rpc.synthetic.invalid',
        explorer: 'https://explorer.synthetic.invalid',
      },
    })
  );
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: { ...initialActiveHdAccountState, id: 0, address: OWNER },
    })
  );
  mockEmitter.mockImplementation(async ([family, method], args) => {
    expect(family).toBe('wallet');
    expect(method).toBe('deleteTokenInfo');
    expect(args[3]).toEqual(MUTATION_SCOPE);
    const commit = EthAccountController().prepareTokenRemoval(
      args[0],
      args[1],
      args[2]
    );
    mockStore.dispatch(commit());
  });
});
afterEach(() => {
  cleanup();
  expect(unexpectedFetches).toEqual([]);
  globalThis.fetch = originalFetch;
  globalThis.ResizeObserver = originalObserver;
});

it.each(['different', 'same'] as const)(
  '%s-symbol ERC721 collections retain unambiguous removal confirmation',
  async (mode) => {
    symbols =
      mode === 'same' ? ['MATCH721', 'MATCH721'] : ['FIRST721', 'SECOND721'];
    const metadata = EvmAssetsController();
    const account = EthAccountController();
    for (const contract of CONTRACTS) {
      // Same actual metadata controller and account preparation used by ImportToken;
      // only the read-only ContractRunner transport is synthetic.
      const details = await metadata.getTokenDetailsWithMarketData(
        contract,
        OWNER,
        runner as any
      );
      expect(details).toMatchObject({
        contractAddress: contract,
        tokenStandard: 'ERC-721',
        isNft: true,
        balance: 1,
      });
      const commit = await account.prepareTokenAddition({
        tokenSymbol: details!.symbol.toUpperCase(),
        contractAddress: details!.contractAddress,
        decimals: Number(details!.decimals ?? 18),
        isNft: true,
        balance: details!.balance,
        chainId: 31337,
        name: details!.name || details!.symbol,
        tokenStandard: 'ERC-721',
      } as any);
      mockStore.dispatch(commit());
    }
    expect(holdings()).toHaveLength(2);
    expect(holdings().map((asset: any) => asset.contractAddress)).toEqual(
      CONTRACTS
    );
    expect(
      reads
        .filter((read) => read.method === 'balanceOf')
        .map((read) => read.address)
    ).toEqual(CONTRACTS);
    mount();
    const before = JSON.stringify(holdings());
    const snapshots = [];
    for (const contract of CONTRACTS) {
      expect(rowFor(contract)).toHaveTextContent(ellipsis(contract, 4, 4));
      fireEvent.click(deleteButton(contract));
      expect(screen.getByRole('dialog')).toHaveTextContent(
        en.settings.contractAddress + ': ' + contract
      );
      expect(screen.getByRole('dialog').querySelector('p')?.textContent).toBe(
        `${
          en.settings.contractAddress
        }: ${contract} ${en.send.deleteCollectionConfirm.replace(
          '{{name}}',
          symbols[CONTRACTS.indexOf(contract)]
        )}`
      );
      expect(screen.getByRole('dialog')).not.toHaveTextContent(
        CONTRACTS.find((candidate) => candidate !== contract)!
      );
      snapshots.push(dialogSnapshot());
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: en.buttons.cancel,
        })
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(JSON.stringify(holdings())).toBe(before);
    }
    // Independently prove that the selected row still removes only its contract;
    // the candidate concerns confirmation identity, never wrong-target authority.
    fireEvent.click(deleteButton(CONTRACTS[1]));
    await act(async () =>
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: en.buttons.delete,
        })
      )
    );
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'deleteTokenInfo'],
      [CONTRACTS[1], 31337, undefined, MUTATION_SCOPE]
    );
    expect(holdings().map((asset: any) => asset.contractAddress)).toEqual([
      CONTRACTS[0],
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    console.info(
      'native_nft_collection_removal_identity=' +
        JSON.stringify({
          mode,
          snapshots,
          reads,
          exactTargetHealthy: true,
          cancelHealthy: true,
        })
    );
    expect(snapshots[0]).not.toEqual(snapshots[1]);
  }
);
