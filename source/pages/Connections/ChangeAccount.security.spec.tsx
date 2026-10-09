import React from 'react';

import { KeyringAccountType } from 'types/network';
import { dispatchBackgroundEvent } from 'utils/browser';

import { ChangeAccount } from './ChangeAccount';

let mockState: any;
let mockQuery: any;
const mockEmitter = jest.fn();
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
    alert: { info: jest.fn() },
    useCopyClipboard: () => [null, jest.fn()],
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
  Tooltip: 'tooltip',
}));
jest.mock('components/Loading/ListLoadMore', () => ({
  ListLoadMore: 'load-more',
}));
jest.mock('components/TokenIcon', () => ({ TokenIcon: 'token-icon' }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));

const elements = (node: React.ReactNode): React.ReactElement[] =>
  React.Children.toArray(node).flatMap((child) =>
    React.isValidElement(child)
      ? [child, ...elements(child.props.children)]
      : []
  );

describe('large account-change approval list', () => {
  const originalWindow = global.window;
  let states: any[];
  let stateIndex: number;
  let memos: Array<{ deps: React.DependencyList; value: any }>;
  let memoIndex: number;
  const memo = (factory: () => any, deps: React.DependencyList) => {
    const index = memoIndex++;
    const previous = memos[index];
    if (
      !previous ||
      previous.deps.length !== deps.length ||
      previous.deps.some((value, i) => value !== deps[i])
    )
      memos[index] = { deps, value: factory() };
    return memos[index].value;
  };
  const render = () => {
    stateIndex = memoIndex = 0;
    return ChangeAccount();
  };
  const rows = (view = render()) =>
    elements(view).filter((element) => element.props.role === 'button');
  const row = (label: string, view = render()) =>
    rows(view).find((element) =>
      elements(element).some((child) => child.props.children === label)
    );
  const selected = (label: string, view = render()) =>
    row(label, view)?.props.className.includes('shadow-md');
  const search = (value: string) =>
    elements(render())
      .find((element) => element.props.type === 'search')!
      .props.onChange({ target: { value } });
  const confirm = () =>
    elements(render()).find(
      (element) => element.props.children === 'buttons.confirm'
    )!;

  beforeEach(() => {
    states = [];
    memos = [];
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
    jest.spyOn(React, 'useMemo').mockImplementation(memo);
    jest
      .spyOn(React, 'useCallback')
      .mockImplementation((callback, deps) => memo(() => callback, deps));
    mockEmitter.mockReset().mockResolvedValue([]);
    (dispatchBackgroundEvent as jest.Mock).mockClear();
    global.window = { close: jest.fn() } as unknown as Window &
      typeof globalThis;
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
      dapp: { dapps: {} },
      vault: {
        accounts: { [KeyringAccountType.HDAccount]: accounts },
        activeAccount: { id: 499, type: KeyringAccountType.HDAccount },
        activeNetwork: { chainId: 1, kind: 'ethereum', url: 'rpc-a' },
        isBitcoinBased: false,
      },
    };
    mockQuery = {
      host: 'https://example.test',
      eventName: 'requestPermissions',
      currentAccountId: 499,
      currentAccountType: KeyringAccountType.HDAccount,
    };
  });
  afterEach(() => {
    jest.restoreAllMocks();
    global.window = originalWindow;
  });

  it('mounts only the first page and pinned current account, including balance loaders', () => {
    const view = render();
    expect(rows(view)).toHaveLength(51);
    expect(selected('Account 500', view)).toBe(true);
    expect(
      elements(view).filter((element) => element.type === 'account-balance')
    ).toHaveLength(51);
    const more = elements(view).find(
      (element) => element.type === 'load-more'
    )!;
    expect(more.props).toMatchObject({ shown: 50, total: 500 });
    more.props.onClick();
    expect(rows()).toHaveLength(101);
  });

  it('keeps both proposed and current accounts visible through search and empty results', () => {
    render();
    search('Account 350');
    expect(rows()).toHaveLength(2);
    row('Account 350')!.props.onClick();
    expect(selected('Account 350')).toBe(true);
    expect(row('Account 500')).toBeDefined();
    search('no-such-account');
    const empty = render();
    expect(rows(empty)).toHaveLength(2);
    expect(selected('Account 350', empty)).toBe(true);
    expect(row('Account 500', empty)).toBeDefined();
    expect(
      elements(empty).find((element) => element.props.role === 'status')?.props
        .children
    ).toBe('connections.noMatchingAccounts');
    search('');
    expect(rows()).toHaveLength(52);
    expect(selected('Account 350')).toBe(true);
  });

  it('searches all addresses and permits keyboard selection beyond the first page', () => {
    render();
    search(mockState.vault.accounts.HDAccount[448].address.toUpperCase());
    const preventDefault = jest.fn();
    row('Account 449')!.props.onKeyDown({ key: ' ', preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(selected('Account 449')).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it('retains the selected account across a balance patch and submits that exact id/type', async () => {
    render();
    search('Account 350');
    row('Account 350')!.props.onClick();
    const accounts = mockState.vault.accounts.HDAccount;
    mockState.vault = {
      ...mockState.vault,
      accounts: {
        HDAccount: {
          ...accounts,
          349: { ...accounts[349], balances: { ethereum: 7, syscoin: -1 } },
        },
      },
    };
    expect(selected('Account 350')).toBe(true);
    expect(mockEmitter).not.toHaveBeenCalled();
    await confirm().props.onClick();
    expect(mockEmitter.mock.calls).toEqual([
      [
        ['dapp', 'requestPermissions'],
        ['https://example.test', 349, KeyringAccountType.HDAccount],
      ],
      [
        ['wallet', 'setAccount'],
        [349, KeyringAccountType.HDAccount, true],
      ],
    ]);
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'requestPermissions.https://example.test',
      []
    );
    expect(window.close).toHaveBeenCalled();
  });

  it('uses the connected account fallback and preserves the normal change-account response', async () => {
    delete mockQuery.currentAccountId;
    delete mockQuery.currentAccountType;
    mockQuery.eventName = 'changeAccount';
    mockState.dapp.dapps[mockQuery.host] = {
      accountId: 498,
      accountType: KeyringAccountType.HDAccount,
    };
    expect(selected('Account 499')).toBe(true);
    search('Account 350');
    row('Account 350')!.props.onClick();
    const change = elements(render()).find(
      (element) => element.props.children === 'buttons.change'
    )!;
    await change.props.onClick();
    expect(mockEmitter.mock.calls).toEqual([
      [
        ['dapp', 'changeAccount'],
        ['https://example.test', 349, KeyringAccountType.HDAccount],
      ],
      [
        ['wallet', 'setAccount'],
        [349, KeyringAccountType.HDAccount, true],
      ],
    ]);
    expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
      'changeAccount.https://example.test',
      null
    );
  });

  it('does not pin or expose network-incompatible accounts in search results', () => {
    mockState.vault.accounts.Imported = {
      7: { id: 7, label: 'UTXO only', address: 'sys1address' },
    };
    mockState.vault.accounts.SmartAccount = {
      0: {
        id: 0,
        label: 'Other chain smart account',
        address: `0x${'1'.repeat(40)}`,
        smartAccount: { chainId: 2 },
      },
    };
    mockQuery.currentAccountId = 0;
    mockQuery.currentAccountType = KeyringAccountType.SmartAccount;
    expect(selected('Account 500')).toBe(true);
    search('Other chain');
    expect(row('Other chain smart account')).toBeUndefined();
    search('UTXO');
    expect(row('UTXO only')).toBeUndefined();
    expect(rows()).toHaveLength(1);
  });

  it('resets pagination for a new search without dropping the visible current selection', () => {
    const more = elements(render()).find(
      (element) => element.type === 'load-more'
    )!;
    more.props.onClick();
    expect(rows()).toHaveLength(101);
    search('Account');
    expect(rows()).toHaveLength(51);
    expect(selected('Account 500')).toBe(true);
  });
});
