import React from 'react';

import { INetworkType, KeyringAccountType } from 'types/network';

import ManageAccounts from './ManageAccounts';

let mockRenderedState: any;
let mockCurrentState: any;
let mockChanging = false;
let mockUnavailable = false;
let mockCurrentUnavailable = false;
const mockControllerEmitter = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockCurrentState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockRenderedState),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn(), alert: mockAlert }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockControllerEmitter,
    connectionUnavailable: mockUnavailable,
  }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    connectionUnavailable: mockCurrentUnavailable,
  }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: mockChanging }),
}));
jest.mock('components/Icon/Icon', () => ({
  RiUserReceivedLine: 'span',
  LockIconSvg: 'span',
  PaliWhiteSmallIconSvg: 'span',
}));
jest.mock('components/index', () => ({
  Button: 'button',
  IconButton: 'button',
  Icon: 'span',
  ConfirmationModal: 'confirmation-dialog',
}));
jest.mock('utils/index', () => ({ ellipsis: (value: string) => value }));
jest.mock('utils/navigationState', () => ({ navigateWithContext: jest.fn() }));
jest.mock('utils/accountCompatibility', () => ({
  isAccountCompatibleWithNetwork: () => true,
}));

const findElement = (
  node: React.ReactNode,
  predicate: (element: React.ReactElement) => boolean
): React.ReactElement | undefined => {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    if (predicate(child)) return child;
    const found = findElement(child.props.children, predicate);
    if (found) return found;
  }
  return undefined;
};

describe('account removal confirmation context', () => {
  let hookStates: any[];
  let hookIndex: number;
  let effects: Array<() => any>;
  const render = () => {
    hookIndex = 0;
    effects = [];
    return (ManageAccounts as any).type();
  };
  const dialog = (view = render()) =>
    findElement(view, (element) => element.type === 'confirmation-dialog');
  const openRemoval = () => {
    const removeButton = findElement(
      render(),
      (element) =>
        element.type === 'button' &&
        Boolean(findElement(element, (child) => child.props.name === 'delete'))
    );
    expect(removeButton).toBeDefined();
    removeButton!.props.onClick();
    const confirmation = dialog();
    expect(confirmation).toBeDefined();
    return confirmation!;
  };

  beforeEach(() => {
    hookStates = [];
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = hookIndex++;
      if (!(index in hookStates)) hookStates[index] = initial;
      return [
        hookStates[index],
        (value: any) => {
          hookStates[index] = value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
    jest.spyOn(React, 'useCallback').mockImplementation((callback) => callback);
    jest
      .spyOn(React, 'useRef')
      .mockImplementation((value) => ({ current: value }));
    jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      effects.push(effect);
    });
    mockChanging = false;
    mockUnavailable = false;
    mockCurrentUnavailable = false;
    mockControllerEmitter.mockReset().mockResolvedValue(undefined);
    mockAlert.error.mockClear();
    mockAlert.success.mockClear();
    mockRenderedState = {
      vault: {
        accounts: {
          HDAccount: {
            0: { id: 0, address: 'anchor-address', label: 'Anchor' },
            7: { id: 7, address: 'selected-address', label: 'Selected' },
          },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          kind: INetworkType.Syscoin,
          chainId: 57,
          url: 'https://rpc.example',
        },
      },
      vaultGlobal: {
        activeSlip44: 57,
        networkStatus: 'idle',
        isSwitchingAccount: false,
      },
    };
    mockCurrentState = mockRenderedState;
  });
  afterEach(() => jest.restoreAllMocks());

  it('binds a healthy removal to the displayed account and full network context', async () => {
    const confirmation = openRemoval();
    await confirmation.props.onClick();
    expect(mockControllerEmitter).toHaveBeenCalledWith(
      ['wallet', 'removeAccount'],
      [
        7,
        KeyringAccountType.HDAccount,
        {
          activeAccount: {
            id: 0,
            type: KeyringAccountType.HDAccount,
            address: 'anchor-address',
          },
          address: 'selected-address',
          network: {
            kind: INetworkType.Syscoin,
            chainId: 57,
            url: 'https://rpc.example',
          },
          slip44: 57,
        },
      ]
    );
    expect(mockAlert.success).toHaveBeenCalledTimes(1);
  });

  it.each(['transition', 'disconnect'])(
    'removes the portal confirmation during %s before cleanup effects and keeps it cleared after recovery',
    (reason) => {
      openRemoval();
      mockChanging = reason === 'transition';
      mockUnavailable = reason === 'disconnect';
      expect(dialog()).toBeUndefined();
      effects.forEach((effect) => effect());
      mockChanging = false;
      mockUnavailable = false;
      expect(dialog()).toBeUndefined();
      expect(mockControllerEmitter).not.toHaveBeenCalled();
    }
  );

  it.each([
    'slip',
    'chain',
    'kind',
    'rpc',
    'active identity',
    'selected identity',
  ])(
    'suppresses the old confirmation when %s changes without a transition render',
    (change) => {
      openRemoval();
      if (change === 'slip') mockRenderedState.vaultGlobal.activeSlip44 = 0;
      if (change === 'chain')
        mockRenderedState.vault.activeNetwork.chainId = 570;
      if (change === 'kind')
        mockRenderedState.vault.activeNetwork.kind = INetworkType.Ethereum;
      if (change === 'rpc')
        mockRenderedState.vault.activeNetwork.url = 'https://other.example';
      if (change === 'active identity')
        mockRenderedState.vault.accounts.HDAccount[0].address = 'new-anchor';
      if (change === 'selected identity')
        mockRenderedState.vault.accounts.HDAccount[7].address =
          'different-account';
      expect(dialog()).toBeUndefined();
      expect(mockControllerEmitter).not.toHaveBeenCalled();
    }
  );

  it('rejects an old portal click when the authoritative UI store has advanced before React renders', async () => {
    const confirmation = openRemoval();
    mockCurrentState = JSON.parse(JSON.stringify(mockRenderedState));
    mockCurrentState.vaultGlobal.activeSlip44 = 0;
    mockCurrentState.vault.accounts.HDAccount[7].address =
      'different-vault-account';
    await confirmation.props.onClick();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
    expect(mockAlert.error).toHaveBeenCalledWith(
      'settings.accountRemovalContextChanged'
    );
    expect(dialog()).toBeUndefined();
  });

  it('rejects a click after worker disconnection before the subscription rerenders', async () => {
    const confirmation = openRemoval();
    mockCurrentUnavailable = true;
    await confirmation.props.onClick();
    expect(mockControllerEmitter).not.toHaveBeenCalled();
    expect(dialog()).toBeUndefined();
  });
});
