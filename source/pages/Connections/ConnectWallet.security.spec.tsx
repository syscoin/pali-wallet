import React from 'react';

import { KeyringAccountType } from 'types/network';

import { ConnectWallet } from './ConnectWallet';

let mockState: any;
let mockQuery: any;
const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockAlert = { info: jest.fn() };
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
  useQueryData: () => mockQuery,
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [null, mockCopy],
  }),
}));
jest.mock('state/vault/selectors', () => ({ selectAccountAssets: () => ({}) }));
jest.mock('components/AccountBalance', () => ({
  LazyAccountBalance: 'account-balance',
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: 'loading' }));
jest.mock('components/index', () => ({
  Button: 'button',
  Icon: 'icon',
  IconButton: 'button',
  Modal: 'modal',
  Tooltip: 'tooltip',
}));
jest.mock('components/Loading/ListLoadMore', () => ({
  ListLoadMore: 'load-more',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: 'token-icon' }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const allElements = (node: React.ReactNode): React.ReactElement[] =>
  React.Children.toArray(node).flatMap((child) =>
    React.isValidElement(child)
      ? [child, ...allElements(child.props.children)]
      : []
  );

describe('large connection approval account selection', () => {
  let states: any[];
  let stateIndex: number;
  let refs: any[];
  let refIndex: number;
  let memos: Array<{ deps: any[]; value: any }>;
  let memoIndex: number;
  let effectDeps: any[][];
  let cleanups: Array<(() => void) | undefined>;
  let effectIndex: number;
  let effects: Array<() => void>;
  const sameDeps = (a?: any[], b?: any[]) =>
    Boolean(
      a &&
        b &&
        a.length === b.length &&
        a.every((value, index) => value === b[index])
    );
  const memo = (factory: () => any, deps: any[]) => {
    const index = memoIndex++;
    if (!sameDeps(memos[index]?.deps, deps))
      memos[index] = { deps, value: factory() };
    return memos[index].value;
  };
  const render = () => {
    stateIndex = refIndex = memoIndex = effectIndex = 0;
    effects = [];
    return ConnectWallet();
  };
  const settle = async () => {
    for (let n = 0; n < 8; n++) await Promise.resolve();
  };
  const initialize = async () => {
    render();
    effects.forEach((effect) => effect());
    await settle();
    return render();
  };
  const rows = (view = render()) =>
    allElements(view).filter((element) => element.props.role === 'button');
  const row = (label: string, view = render()) =>
    rows(view).find((element) =>
      allElements(element).some((child) => child.props.children === label)
    )!;
  const selected = (label: string, view = render()) =>
    row(label, view)?.props.className.includes('shadow-md');
  const search = (value: string) =>
    allElements(render())
      .find((element) => element.props.type === 'search')!
      .props.onChange({ target: { value } });

  beforeEach(() => {
    states = [];
    refs = [];
    memos = [];
    effectDeps = [];
    cleanups = [];
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = stateIndex++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        states[index],
        (value: any) => {
          states[index] =
            typeof value === 'function' ? value(states[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useRef').mockImplementation((initial?: any) => {
      const index = refIndex++;
      if (!(index in refs)) refs[index] = { current: initial };
      return refs[index];
    });
    jest.spyOn(React, 'useMemo').mockImplementation(memo);
    jest
      .spyOn(React, 'useCallback')
      .mockImplementation((callback, deps) => memo(() => callback, deps));
    jest.spyOn(React, 'useEffect').mockImplementation((effect, deps) => {
      const index = effectIndex++;
      if (!sameDeps(effectDeps[index], deps)) {
        effectDeps[index] = deps;
        effects.push(() => {
          cleanups[index]?.();
          cleanups[index] = effect() as any;
        });
      }
    });
    mockEmitter.mockReset().mockResolvedValue(null);
    const accounts = Object.fromEntries(
      Array.from({ length: 500 }, (_, id) => [
        id,
        {
          id,
          label: `Account ${id + 1}`,
          address: `0x${id.toString(16).padStart(40, '0')}`,
          balances: { ethereum: -1, syscoin: -1 },
        },
      ])
    );
    mockState = {
      vault: {
        accounts: { [KeyringAccountType.HDAccount]: accounts },
        activeAccount: { id: 499, type: KeyringAccountType.HDAccount },
        activeNetwork: { chainId: 1, kind: 'ethereum', url: 'rpc-a' },
        isBitcoinBased: false,
      },
    };
    mockQuery = {
      host: 'https://example.test',
      chain: 'ethereum',
      chainId: 1,
      eventName: 'connect',
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it('bounds initial mounted accounts while keeping the selected last account visible', async () => {
    const view = await initialize();
    expect(rows(view)).toHaveLength(51);
    expect(selected('Account 500', view)).toBe(true);
    const more = allElements(view).find(
      (element) => element.type === 'load-more'
    )!;
    expect(more.props).toMatchObject({ shown: 50, total: 500 });
    more.props.onClick();
    expect(rows()).toHaveLength(101);
  });

  it('searches every account and keeps selection after clearing the search', async () => {
    await initialize();
    search('Account 350');
    expect(rows()).toHaveLength(1);
    row('Account 350').props.onClick();
    expect(selected('Account 350')).toBe(true);
    search('');
    expect(rows()).toHaveLength(51);
    expect(selected('Account 350')).toBe(true);
    expect(row('Account 500')).toBeUndefined();
  });

  it('does not reset the chosen account or refetch connection state on a balance patch', async () => {
    await initialize();
    row('Account 1').props.onClick();
    render();
    const current = mockState.vault.accounts.HDAccount;
    mockState = {
      vault: {
        ...mockState.vault,
        accounts: {
          HDAccount: {
            ...current,
            0: { ...current[0], balances: { ethereum: 7, syscoin: -1 } },
          },
        },
      },
    };
    const view = render();
    effects.forEach((effect) => effect());
    await settle();
    expect(selected('Account 1', view)).toBe(true);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard selection from a search result', async () => {
    await initialize();
    search('Account 499');
    const preventDefault = jest.fn();
    row('Account 499').props.onKeyDown({ key: 'Enter', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(selected('Account 499')).toBe(true);
  });

  it('renders a translated empty state without losing the selected account', async () => {
    await initialize();
    search('no-such-account');
    const view = render();
    expect(rows(view)).toHaveLength(0);
    expect(
      allElements(view).find((element) => element.props.role === 'status')
        ?.props.children
    ).toBe('connections.noMatchingAccounts');
    search('');
    expect(selected('Account 500')).toBe(true);
  });
});
