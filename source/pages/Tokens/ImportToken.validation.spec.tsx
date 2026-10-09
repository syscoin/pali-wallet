import React from 'react';
import { useSelector } from 'react-redux';
import { useSearchParams } from 'react-router-dom';

import { useController } from 'hooks/useController';
import { getCurrentTab } from 'utils/navigationState';

import { ImportToken } from './ImportToken';

jest.mock('components/Icon/Icon', () => ({
  TbFileImport: 'span',
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
  useLocation: () => ({ state: null }),
  useSearchParams: jest.fn(() => [
    new URLSearchParams('tab=custom'),
    jest.fn(),
  ]),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/navigationState', () => ({
  getCurrentTab: jest.fn(() => 'custom'),
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

  it('attributes Routescan only on its owned-token discovery tab', () => {
    (getCurrentTab as jest.Mock).mockReturnValue('owned');
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
    const attribution = find(
      render(),
      (element) => element.props.href === 'https://routescan.io'
    );
    expect(attribution?.props.children).toBe('Routescan.io APIs');
    expect(
      find(
        render(),
        (element) => element.props.children === 'tokens.discoveryUnavailable'
      )
    ).toBeUndefined();
    const customTab = find(
      render(),
      (element) => element.props.children === 'tokens.addCustomTab'
    );
    customTab!.props.onClick();
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

  it.each([8453, 42161])(
    'explains manual import when network %s has no discovery API',
    (chainId) => {
      (getCurrentTab as jest.Mock).mockReturnValue('owned');
      (useSelector as jest.Mock).mockReturnValue({
        activeAccount: { type: 'HDAccount', id: 0 },
        accounts: { HDAccount: { 0: { address: ADDRESS } } },
        activeNetwork: { chainId },
        accountAssets: {},
      });
      render();
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
          (element) =>
            element.props.placeholder === 'tokens.enterContractAddress'
        )
      ).toBeDefined();
      expect(emitter).not.toHaveBeenCalled();
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
