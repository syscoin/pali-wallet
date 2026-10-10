import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation, useSearchParams } from 'react-router-dom';

import { getHomeBrowsingScope } from '../Home/useHomeBrowsingState';
import { useController } from 'hooks/useController';
import { getCurrentTab, navigateWithContext } from 'utils/navigationState';

import { ImportToken } from './ImportToken';

jest.mock('components/Icon/Icon', () => ({
  FiDownload: 'span',
  LoadingOutlined: 'loading-icon',
  CheckCircleOutlined: 'success-icon',
  CloseCircleOutlined: 'error-icon',
}));
jest.mock('components/index', () => ({ ImportableAssetsList: 'asset-list' }));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({ useController: jest.fn() }));
jest.mock('react-redux', () => ({ useSelector: jest.fn() }));
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: jest.fn(() => ({
    pathname: '/tokens/add',
    search: '?tab=custom',
    hash: '',
    state: null,
  })),
  useSearchParams: jest.fn(() => [
    new URLSearchParams('tab=custom'),
    jest.fn(),
  ]),
}));
jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));
jest.mock('utils/navigationState', () => ({
  getCurrentTab: jest.fn(() => 'custom'),
  createBrowsingNavigationContext: (location: any, extra: any) => ({
    returnRoute: `${location.pathname}${location.search}${location.hash}`,
    state: extra,
    returnContext: location.state?.returnContext,
  }),
  navigateWithContext: jest.fn(),
}));

const ADDRESS = `0x${'11'.repeat(20)}`;
const TOKEN = `0x${'33'.repeat(20)}`;
const find = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = find(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};
const findAll = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement[] =>
  React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement(child)) return [];
    return [
      ...(predicate(child) ? [child] : []),
      ...findAll(child.props.children, predicate),
    ];
  });

describe('custom token validation cancellation', () => {
  let cursor: number;
  let slots: any[];
  let effects: (() => void)[];
  let emitter: jest.Mock;
  let resolve: (value: any) => void;
  const render = () => {
    cursor = 0;
    effects = [];
    const tree = ImportToken({});
    effects.forEach((effect) => effect());
    return tree;
  };
  const changeAddress = (address: string) => {
    const input = find(
      render(),
      (element) => element.props.placeholder === 'tokens.enterContractAddress'
    );
    input!.props.onChange({ target: { value: address } });
    return render();
  };
  const loading = () =>
    Boolean(find(render(), (element) => element.type === 'loading-icon'));

  beforeEach(() => {
    jest.useFakeTimers();
    slots = [];
    (useLocation as jest.Mock).mockReturnValue({
      pathname: '/tokens/add',
      search: '?tab=custom',
      hash: '',
      state: null,
    });
    (navigateWithContext as jest.Mock).mockClear();
    (useTranslation as jest.Mock).mockReturnValue({
      t: (key: string) => key,
      i18n: { resolvedLanguage: 'en', language: 'en' },
    });
    (getCurrentTab as jest.Mock).mockReturnValue('custom');
    (useSearchParams as jest.Mock).mockReturnValue([
      new URLSearchParams('tab=custom'),
      jest.fn(),
    ]);
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!(index in slots))
        slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value: any) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useRef').mockImplementation((value) => {
      const index = cursor++;
      return slots[index] || (slots[index] = { current: value });
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useCallback').mockImplementation((callback) => callback);
    jest.spyOn(React, 'useDeferredValue').mockImplementation((value) => value);
    jest
      .spyOn(React, 'useEffect')
      .mockImplementation((effect, dependencies) => {
        const index = cursor++;
        const old = slots[index];
        if (
          old &&
          dependencies?.every((value, i) =>
            Object.is(value, old.dependencies?.[i])
          )
        )
          return;
        effects.push(() => {
          old?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
        });
      });
    emitter = jest.fn(([, method]) =>
      method === 'getUserOwnedTokens'
        ? Promise.resolve([])
        : new Promise((done) => {
            resolve = done;
          })
    );
    (useController as jest.Mock).mockReturnValue({
      controllerEmitter: emitter,
    });
    (useSelector as jest.Mock).mockReturnValue({
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: ADDRESS } } },
      activeNetwork: { chainId: 1, apiUrl: 'https://explorer.test/api' },
      accountAssets: {},
    });
  });
  afterEach(() => {
    slots.forEach((slot) => slot?.cleanup?.());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps Ethereum discovery tabs free of provider links and offers manual import after an empty scan', async () => {
    (getCurrentTab as jest.Mock).mockReturnValue('owned');
    (useSearchParams as jest.Mock).mockReturnValue([
      new URLSearchParams('tab=owned'),
      jest.fn(),
    ]);
    (useSelector as jest.Mock).mockReturnValue({
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: ADDRESS } } },
      activeNetwork: {
        chainId: 1,
        apiUrl:
          'https://api.routescan.io/v2/network/mainnet/evm/1/etherscan/api',
      },
      accountAssets: {},
    });
    const tree = render();
    expect(
      find(tree, (element) => element.props.children === 'tokens.yourTokens')
    ).toBeDefined();
    expect(
      find(tree, (element) => element.props.children === 'tokens.addCustomTab')
    ).toBeDefined();
    expect(
      find(tree, (element) => element.props.href === 'https://routescan.io')
    ).toBeUndefined();
    await jest.advanceTimersByTimeAsync(0);
    const loaded = render();
    expect(
      find(
        loaded,
        (element) => element.props.children === 'tokens.noAdditionalTokensFound'
      )
    ).toBeDefined();
    expect(
      find(
        loaded,
        (element) =>
          element.props.children === 'tokens.missingTokenManualImport'
      )
    ).toBeDefined();
    const customActions = findAll(
      render(),
      (element) =>
        element.type === 'button' &&
        element.props.children === 'tokens.addCustomTab'
    );
    expect(customActions).toHaveLength(2);
    customActions[1].props.onClick();
    expect(
      find(render(), (element) => element.props.id === 'custom-token-contract')
    ).toBeDefined();
    expect(
      find(render(), (element) => element.props.href === 'https://routescan.io')
    ).toBeUndefined();
    expect(
      find(
        render(),
        (element) => element.props.children === 'tokens.discoveryUnavailable'
      )
    ).toBeUndefined();
  });

  it('preserves the return chain while replacing the import tab URL', () => {
    const returnContext = { returnRoute: '/home?tab=assets' };
    const state = { returnContext };
    const setSearchParams = jest.fn();
    (useLocation as jest.Mock).mockReturnValue({
      pathname: '/tokens/add',
      search: '?tab=custom',
      hash: '',
      state,
    });
    (useSearchParams as jest.Mock).mockReturnValue([
      new URLSearchParams('tab=custom'),
      setSearchParams,
    ]);
    const ownedTab = find(
      render(),
      (element) =>
        element.type === 'button' &&
        element.props.children === 'tokens.yourTokens'
    );
    ownedTab!.props.onClick();
    expect(setSearchParams).toHaveBeenCalledWith(expect.any(URLSearchParams), {
      replace: true,
      state,
    });
    expect(setSearchParams.mock.calls[0][0].get('tab')).toBe('owned');
  });

  it('restores token ID zero and carries it through a nested details preview', () => {
    const returnContext = { returnRoute: '/home?tab=assets' };
    const customTokenDetails = {
      contractAddress: TOKEN,
      tokenStandard: 'ERC-1155',
      isNft: true,
      name: 'Collection',
      symbol: 'NFT',
      balance: 1,
    };
    (useLocation as jest.Mock).mockReturnValue({
      pathname: '/tokens/add',
      search: '?tab=custom&keep=1',
      hash: '',
      state: {
        customContractAddress: TOKEN,
        customTokenDetails,
        customTokenId: '0',
        tokenImportScope: getHomeBrowsingScope(
          { type: 'HDAccount', id: 0, address: ADDRESS },
          { chainId: 1, apiUrl: 'https://explorer.test/api' }
        ),
        returnContext,
      },
    });
    const tree = render();
    expect(
      find(tree, (element) => element.props.id === 'custom-token-id')?.props
        .value
    ).toBe('0');
    const assetList = find(tree, (element) => element.type === 'asset-list');
    assetList!.props.onDetailsClick({ id: 'nft-preview' });
    expect(navigateWithContext).toHaveBeenCalledWith(
      expect.any(Function),
      '/home/details',
      { id: 'nft-preview', isImportPreview: true },
      expect.objectContaining({
        returnRoute: '/tokens/add?tab=custom&keep=1',
        returnContext,
        state: {
          customContractAddress: TOKEN,
          tab: 'custom',
          customTokenId: '0',
          tokenImportScope: getHomeBrowsingScope(
            { type: 'HDAccount', id: 0, address: ADDRESS },
            { chainId: 1, apiUrl: 'https://explorer.test/api' }
          ),
        },
      })
    );
  });

  it('does not restore a custom token preview from another account or network', () => {
    (useLocation as jest.Mock).mockReturnValue({
      pathname: '/tokens/add',
      search: '?tab=custom',
      hash: '',
      state: {
        customContractAddress: TOKEN,
        customTokenDetails: {
          contractAddress: TOKEN,
          tokenStandard: 'ERC-1155',
          isNft: true,
          symbol: 'NFT',
        },
        customTokenId: '0',
        tokenImportScope: 'another-account-or-network',
      },
    });
    const tree = render();
    expect(
      find(tree, (element) => element.props.id === 'custom-token-contract')
        ?.props.value
    ).toBe('');
    expect(
      find(tree, (element) => element.props.id === 'custom-token-id')
    ).toBeUndefined();
  });

  it.each([8453, 42161])(
    'explains manual import when network %s has no discovery API',
    (chainId) => {
      (getCurrentTab as jest.Mock).mockReturnValue('owned');
      (useSearchParams as jest.Mock).mockReturnValue([
        new URLSearchParams('tab=owned'),
        jest.fn(),
      ]);
      (useSelector as jest.Mock).mockReturnValue({
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { address: ADDRESS } } },
        activeNetwork: { chainId },
        accountAssets: {},
      });
      const tree = render();
      expect(
        find(
          tree,
          (element) => element.props.children === 'tokens.discoveryUnavailable'
        )
      ).toBeDefined();
      expect(
        find(tree, (element) => element.props.children === 'tokens.yourTokens')
      ).toBeUndefined();
      expect(
        find(
          tree,
          (element) => element.props.children === 'tokens.addCustomTab'
        )
      ).toBeUndefined();
      const contractInput = find(
        tree,
        (element) => element.props.id === 'custom-token-contract'
      );
      expect(
        find(
          tree,
          (element) =>
            element.type === 'label' &&
            element.props.htmlFor === contractInput?.props.id
        )
      ).toBeDefined();
      expect(contractInput?.props.value).toBe('');
      expect(
        find(tree, (element) => element.props.children === 'tokens.importHelp')
          ?.props.href
      ).toBe(
        'https://docs.paliwallet.com/docs/users/token-discovery-and-explorer-apis'
      );
      expect(
        find(
          tree,
          (element) => element.props.children === 'tokens.addCustomToken'
        )
      ).toBeUndefined();
      expect(emitter).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['en-US', ''],
    ['es', '/es'],
    ['pt-BR', '/pt'],
    ['fr', '/fr'],
    ['de', '/de'],
    ['ru', '/ru'],
    ['zh-CN', '/zh'],
    ['ja', '/ja'],
    ['ko-KR', '/ko'],
    ['it', ''],
  ])('opens the supported guide locale for %s', (language, prefix) => {
    (useTranslation as jest.Mock).mockReturnValue({
      t: (key: string) => key,
      i18n: { resolvedLanguage: language, language },
    });
    (useSelector as jest.Mock).mockReturnValue({
      activeAccount: { type: 'HDAccount', id: 0 },
      accounts: { HDAccount: { 0: { address: ADDRESS } } },
      activeNetwork: { chainId: 8453 },
      accountAssets: {},
    });
    const help = find(
      render(),
      (element) => element.props.children === 'tokens.importHelp'
    );
    expect(help?.props.href).toBe(
      `https://docs.paliwallet.com${prefix}/docs/users/token-discovery-and-explorer-apis`
    );
    expect(help?.props.rel).toBe('noopener noreferrer');
  });

  it.each([1, 8453])(
    'keeps the manual form accessible when network %s loses its API with an owned-tab URL',
    (chainId) => {
      (getCurrentTab as jest.Mock).mockReturnValue('owned');
      const params = new URLSearchParams('tab=owned');
      (useSearchParams as jest.Mock).mockReturnValue([params, jest.fn()]);
      const state = {
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { address: ADDRESS } } },
        activeNetwork: { chainId: 1, apiUrl: 'https://explorer.test/api' },
        accountAssets: {},
      };
      (useSelector as jest.Mock).mockReturnValue(state);
      render();
      expect(
        find(
          render(),
          (element) =>
            element.props.placeholder === 'tokens.enterContractAddress'
        )
      ).toBeUndefined();
      expect(emitter).toHaveBeenCalledTimes(1);

      (useSelector as jest.Mock).mockReturnValue({
        ...state,
        activeNetwork: { chainId },
      });
      render();
      expect(
        find(
          render(),
          (element) =>
            element.props.placeholder === 'tokens.enterContractAddress'
        )
      ).toBeDefined();
      expect(emitter).toHaveBeenCalledTimes(1);
      expect(params.get('tab')).toBe('owned');

      (useSelector as jest.Mock).mockReturnValue(state);
      render();
      expect(
        find(
          render(),
          (element) =>
            element.props.placeholder === 'tokens.enterContractAddress'
        )
      ).toBeUndefined();
      expect(emitter).toHaveBeenCalledTimes(2);
    }
  );

  it('clears the spinner after a pending full address is shortened, without applying the cancelled result', async () => {
    changeAddress(TOKEN);
    await jest.advanceTimersByTimeAsync(500);
    expect(loading()).toBe(true);
    changeAddress('0x123');
    await jest.advanceTimersByTimeAsync(500);
    expect(loading()).toBe(false);
    resolve({ contractAddress: TOKEN, symbol: 'OLD', balance: 10 });
    await jest.advanceTimersByTimeAsync(0);
    expect(loading()).toBe(false);
    expect(
      find(render(), (element) => element.type === 'success-icon')
    ).toBeUndefined();
    expect(
      emitter.mock.calls.filter(
        ([[, method]]) => method !== 'getUserOwnedTokens'
      )
    ).toHaveLength(1);
  });

  it('removes the previous importable contract as soon as its input changes', async () => {
    changeAddress(TOKEN);
    await jest.advanceTimersByTimeAsync(500);
    resolve({
      contractAddress: TOKEN,
      symbol: 'OLD',
      name: 'Old Token',
      decimals: 18,
      balance: 10,
      chainId: 1,
      tokenStandard: 'ERC-20',
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(
      find(render(), (element) => element.type === 'asset-list')?.props
        .assets[0].contractAddress
    ).toBe(TOKEN);

    const changed = changeAddress(ADDRESS);
    expect(
      find(changed, (element) => element.type === 'asset-list')
    ).toBeUndefined();
    expect(
      find(changed, (element) => element.type === 'success-icon')
    ).toBeUndefined();
    expect(
      emitter.mock.calls.filter(
        ([[, method]]) => method !== 'getUserOwnedTokens'
      )
    ).toHaveLength(1);
  });

  it('offers an explicit retry after a discovery failure without automatic idle requests', async () => {
    (getCurrentTab as jest.Mock).mockReturnValue('owned');
    (useSearchParams as jest.Mock).mockReturnValue([
      new URLSearchParams('tab=owned'),
      jest.fn(),
    ]);
    emitter
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValueOnce([]);
    render();
    await jest.advanceTimersByTimeAsync(0);
    expect(
      find(render(), (element) => element.props.role === 'alert')
    ).toBeDefined();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(emitter).toHaveBeenCalledTimes(1);
    const retry = find(
      render(),
      (element) =>
        element.type === 'button' && element.props.children === 'receive.retry'
    );
    expect(retry).toBeDefined();
    await retry!.props.onClick();
    expect(emitter).toHaveBeenCalledTimes(2);
    expect(
      find(render(), (element) => element.props.role === 'alert')
    ).toBeUndefined();
  });
});
