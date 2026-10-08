import React from 'react';
import { useSelector } from 'react-redux';

import { useController } from 'hooks/useController';

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
  useSearchParams: () => [new URLSearchParams('tab=custom'), jest.fn()],
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/navigationState', () => ({ getCurrentTab: () => 'custom' }));

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
      activeNetwork: { chainId: 1 },
      accountAssets: {},
    });
  });
  afterEach(() => {
    slots.forEach((slot) => slot?.cleanup?.());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

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
});
